"""Task workspaces: sandboxed copies of a fixture repo with a git baseline.

The workspace layer owns every filesystem fact the harness trusts:
containment checks, protected-file snapshots, changed-file lists, and patches.
Tools call into it instead of reimplementing path handling.
"""

from __future__ import annotations

import hashlib
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

from .errors import WorkspaceError

EXCLUDED_NAMES = {"task.json", "reference", "policy.json", ".git", "__pycache__", ".pytest_cache"}


def _sha1(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 128), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_python(command: str) -> str:
    """Replace the ``{python}`` task token with the running interpreter.

    ``shlex.quote`` keeps paths with spaces (virtualenvs on macOS) intact.
    """
    return command.replace("{python}", shlex.quote(sys.executable))


class TaskWorkspace:
    def __init__(self, root: Path, source: Path | None = None) -> None:
        self.root = root.resolve()
        self.source = source
        self._baseline: str | None = None

    @classmethod
    def prepare(cls, source: Path, dest: Path) -> "TaskWorkspace":
        source = source.resolve()
        dest = dest.resolve()
        if not source.is_dir():
            raise WorkspaceError(f"task repo does not exist: {source}")
        if dest.is_relative_to(source):
            raise WorkspaceError("workspace destination must be outside the source repo")
        if dest.exists():
            raise WorkspaceError(f"workspace already exists: {dest}")
        dest.mkdir(parents=True)
        for child in sorted(source.iterdir()):
            if child.name in EXCLUDED_NAMES:
                continue
            target = dest / child.name
            if child.is_symlink():
                target.symlink_to(child.readlink())
            elif child.is_dir():
                shutil.copytree(
                    child,
                    target,
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", ".git"),
                    symlinks=True,
                )
            else:
                shutil.copy2(child, target)

        workspace = cls(dest, source)
        for args in (
            ("init", "-q"),
            ("config", "user.email", "harness@agent-replay.local"),
            ("config", "user.name", "Agent Replay Harness"),
            ("add", "-A"),
            ("commit", "-qm", "initial"),
        ):
            result = workspace.git(*args)
            if result.returncode != 0:
                raise WorkspaceError(
                    f"git {' '.join(args)} failed in {dest}: {workspace.git_error(result)}"
                )
        status = workspace.git("status", "--porcelain")
        if status.returncode != 0 or status.stdout.strip():
            raise WorkspaceError(
                f"workspace is not clean after baseline commit: {status.stdout.strip()}"
            )
        workspace._baseline = workspace.baseline_commit()
        return workspace

    # --- git ---------------------------------------------------------------

    def git(self, *args: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                ["git", *args],
                cwd=str(self.root),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise WorkspaceError(f"git {' '.join(args)} failed: {exc}") from exc

    @staticmethod
    def git_error(result: subprocess.CompletedProcess[str]) -> str:
        return (result.stderr or result.stdout).strip()

    def baseline_commit(self) -> str:
        if self._baseline is not None:
            return self._baseline
        result = self.git("rev-parse", "HEAD")
        return result.stdout.strip() if result.returncode == 0 else ""

    # --- path containment ---------------------------------------------------

    def resolve(self, relative: str, *, must_exist: bool = False, allow_git: bool = False) -> Path:
        if not isinstance(relative, str) or not relative.strip():
            raise WorkspaceError("path must be a non-empty string")
        if "\x00" in relative:
            raise WorkspaceError("path contains a NUL byte")
        candidate = Path(relative)
        if candidate.is_absolute():
            raise WorkspaceError(f"absolute paths are not allowed: {relative}")
        if any(part == ".." for part in candidate.parts):
            raise WorkspaceError(f"parent traversal is not allowed: {relative}")
        if not allow_git and any(part == ".git" for part in candidate.parts):
            raise WorkspaceError("the .git directory is not accessible to tools")

        # Lexical check first, then resolve symlinks. A symlink inside the
        # workspace that points outside must not be readable or writable.
        lexical = (self.root / candidate).resolve(strict=False)
        if not lexical.is_relative_to(self.root):
            raise WorkspaceError(f"path escapes the workspace: {relative}")
        if not allow_git and ".git" in lexical.relative_to(self.root).parts:
            raise WorkspaceError("the .git directory is not accessible to tools")
        if must_exist and not lexical.exists():
            raise WorkspaceError(f"path does not exist: {relative}")
        return lexical

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    # --- facts --------------------------------------------------------------

    def changed_files(self) -> list[str]:
        result = self.git("diff", "--name-only", "-z", "--no-renames", self.baseline_commit(), "--", ".")
        if result.returncode != 0:
            raise WorkspaceError(f"git status failed: {self.git_error(result)}")
        untracked = self.git("ls-files", "--others", "--exclude-standard", "-z")
        if untracked.returncode != 0:
            raise WorkspaceError(f"git ls-files failed: {self.git_error(untracked)}")
        return sorted(set(filter(None, (result.stdout + untracked.stdout).split("\0"))))

    def snapshot(self, paths: tuple[str, ...] | list[str]) -> dict[str, str]:
        """Hash protected files, plus markers for dirs/missing paths.

        Directory markers catch a newly *added* file inside a protected dir
        even when the dir had no files at baseline.
        """
        snapshot: dict[str, str] = {}
        for relative in paths:
            path = self.resolve(relative, allow_git=True)
            if path.is_file():
                snapshot[relative] = _sha1(path)
            elif path.is_dir():
                snapshot[relative.rstrip("/") + "/"] = "directory"
                for child in sorted(path.rglob("*")):
                    if child.is_file() and "__pycache__" not in child.parts:
                        snapshot[child.relative_to(self.root).as_posix()] = _sha1(child)
            else:
                snapshot[relative] = "missing"
        return snapshot

    def modified_since(self, before: dict[str, str]) -> list[str]:
        current = self.snapshot(tuple(before.keys()))
        # Recompute from the real paths rather than trusting marker keys that
        # may have appeared or disappeared.
        changed: list[str] = []
        for key, digest in before.items():
            if current.get(key) != digest:
                changed.append(key.rstrip("/"))
        for key in current:
            if key not in before:
                changed.append(key.rstrip("/"))
        return sorted(set(changed))

    def snapshot_paths(self, before: dict[str, str]) -> dict[str, str]:
        paths: list[str] = []
        for key in before:
            paths.append(key.rstrip("/") + "/" if before[key] == "directory" else key)
        return self.snapshot(tuple(paths))

    def patch(self) -> str:
        # Intent-to-add makes untracked files visible in `git diff` without
        # staging their content.
        add = self.git("add", "-N", "--", ".")
        if add.returncode != 0:
            raise WorkspaceError(f"git add -N failed: {self.git_error(add)}")
        diff = self.git("diff", "--no-ext-diff", "--no-textconv", "--binary", self.baseline_commit(), "--", ".", timeout=120)
        if diff.returncode != 0:
            raise WorkspaceError(f"git diff failed: {self.git_error(diff)}")
        return diff.stdout

    def diff_stat(self) -> str:
        self.git("add", "-N", "--", ".")
        result = self.git("diff", "--stat", self.baseline_commit(), "--", ".")
        return result.stdout.strip()

    def read_text_file(self, relative: str, max_bytes: int) -> tuple[str, bool]:
        path = self.resolve(relative, must_exist=True)
        if not path.is_file():
            raise WorkspaceError(f"not a regular file: {relative}")
        size = path.stat().st_size
        with path.open("rb") as handle:
            raw = handle.read(max_bytes + 1)
        truncated = len(raw) > max_bytes or size > max_bytes
        return raw[:max_bytes].decode("utf-8", errors="replace"), truncated
