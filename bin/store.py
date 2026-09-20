#!/usr/bin/python3 -I
"""Read and write the Store through descriptors, never through a pathname twice.

Quickshell's FileView, `cat` and a shell redirect all follow a symlink, block on
a FIFO and read the whole file before any size check runs. Another process
running as this user can plant any of those at the Store's path. So this
helper does one open with the refusals attached to it — O_NOFOLLOW, O_NONBLOCK —
validates the descriptor it got, and reads or writes through that descriptor.

Usage:
    store.py read  <absolute-path> <max-bytes>     bytes on stdout
    store.py write <absolute-path> <max-bytes>     payload on stdin

Exit codes:
    0  done
    2  usage
    3  the file does not exist (read only; the caller treats this as empty)
    4  refused: a component is not what it should be (symlink, FIFO, wrong owner,
       writable by others, more than one link, ...). A file that group or
       others can write is refused too: whoever can write it can write notes.
    5  too large

Directory policy. The plugin's own state directory, ~/.local/share/omacopper,
is walked from the passwd home one component at a time with O_NOFOLLOW, and
created with mode 0700 where missing. Any other directory is one the person
named in shell.json, so its components may legitimately be symlinks; those
are walked following symlinks but every component must be a directory owned
by this user (or by root and not world-writable, for system parents such as
/home), and the final directory must be owned by this user and not writable by
anyone else. Nothing is created there.

Writes go to an exclusively created random temporary in the same directory,
mode set before the first byte, fsync, then rename over the destination — which
replaces a symlink planted there instead of writing through it — and fsync of
the directory. A file that already exists and is a regular file of ours keeps
its permission bits (capped at 0644) so a note kept in a vault stays readable
the way it was; a new file is 0600.
"""

import os
import pwd
import secrets
import stat
import sys

OWN_DIR = (".local", "share", "omacopper")
MAX_PATH = 4096
MAX_CAP = 8 * 1024 * 1024


def fail(code):
    sys.exit(code)


def component_ok(name):
    if name in ("", ".", ".."):
        return False
    if len(name.encode("utf-8", "surrogateescape")) > 255:
        return False
    return all(ord(c) >= 0x20 and ord(c) != 0x7F for c in name)


def home():
    return pwd.getpwuid(os.geteuid()).pw_dir


def open_own_dir(parts):
    """Walk from the passwd home with held descriptors, creating the leaf chain 0700."""
    fd = os.open(home(), os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for i, name in enumerate(parts):
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
            try:
                nfd = os.open(name, flags, dir_fd=fd)
            except FileNotFoundError:
                try:
                    os.mkdir(name, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                nfd = os.open(name, flags, dir_fd=fd)
            os.close(fd)
            fd = nfd
            st = os.fstat(fd)
            if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid():
                fail(4)
            if i == len(parts) - 1 and st.st_mode & 0o077:
                os.fchmod(fd, 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_named_dir(parts):
    """Walk an absolute directory the person configured, following symlinks."""
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for name in parts:
            nfd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = nfd
            st = os.fstat(fd)
            if not stat.S_ISDIR(st.st_mode):
                fail(4)
            if st.st_uid == os.geteuid():
                continue
            if st.st_uid == 0 and not st.st_mode & 0o002:
                continue
            fail(4)
        st = os.fstat(fd)
        if st.st_uid != os.geteuid() or st.st_mode & 0o022:
            fail(4)
        return fd
    except FileNotFoundError:
        fail(4)
    except BaseException:
        os.close(fd)
        raise


def open_dir_for(path):
    """Return (dirfd, filename) for an absolute path, under the policy above."""
    if not path.startswith("/") or len(path) > MAX_PATH or "\0" in path:
        fail(2)
    parts = [p for p in path.split("/") if p != ""]
    if not parts or not all(component_ok(p) for p in parts):
        fail(2)
    name = parts[-1]
    dirs = parts[:-1]
    own = [p for p in home().split("/") if p != ""] + list(OWN_DIR)
    if dirs == own:
        return open_own_dir(list(OWN_DIR)), name
    return open_named_dir(dirs), name


def read_bounded(dirfd, name, cap):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=dirfd)
    except FileNotFoundError:
        fail(3)
    except OSError:
        fail(4)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1:
            fail(4)
        if st.st_mode & 0o022:
            fail(4)
        if st.st_size > cap:
            fail(5)
        os.set_blocking(fd, True)
        data = b""
        while len(data) <= cap:
            chunk = os.read(fd, min(65536, cap + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        if len(data) > cap:
            fail(5)
        return data
    finally:
        os.close(fd)


def existing_mode(dirfd, name):
    """Permission bits to keep for a file we are replacing, or None for a new file."""
    try:
        st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid():
        # Not ours to replace by writing; rename still replaces a symlink at
        # the destination, which is the point, but the mode starts private.
        return 0o600
    return st.st_mode & 0o644


def write_atomic(dirfd, name, data):
    mode = existing_mode(dirfd, name)
    if mode is None:
        mode = 0o600
    tmp = "." + name + "." + secrets.token_hex(8) + ".tmp"
    fd = os.open(
        tmp,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
        dir_fd=dirfd,
    )
    try:
        os.fchmod(fd, mode)
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
        os.fsync(fd)
        os.rename(tmp, name, src_dir_fd=dirfd, dst_dir_fd=dirfd)
        os.fsync(dirfd)
    except BaseException:
        try:
            os.unlink(tmp, dir_fd=dirfd)
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


def main(argv):
    if len(argv) != 4 or argv[1] not in ("read", "write"):
        fail(2)
    op, path, cap = argv[1], argv[2], argv[3]
    if not cap.isdigit() or int(cap) < 1 or int(cap) > MAX_CAP:
        fail(2)
    cap = int(cap)
    dirfd, name = open_dir_for(path)
    try:
        if op == "read":
            sys.stdout.buffer.write(read_bounded(dirfd, name, cap))
            sys.stdout.buffer.flush()
        else:
            payload = sys.stdin.buffer.read(cap + 1)
            if len(payload) > cap:
                fail(5)
            write_atomic(dirfd, name, payload)
    finally:
        os.close(dirfd)


if __name__ == "__main__":
    main(sys.argv)
