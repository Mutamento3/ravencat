#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 docs/architecture-snapshot.md，记录完整源码文件树。
"""

import argparse
import os
import sys
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parent.parent

EXCLUDED_DIRS = {
    "node_modules",
    ".git",
    ".expo",
    "ios",
    "build",
    ".cxx",
    ".transforms",
    "__pycache__",
    ".next",
    "dist",
    "outputs",
    "intermediates",
    "generated",
    "kotlin",
    "tmp",
}

CODE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".kt"}

def is_code_file(path: Path) -> bool:
    return path.suffix in CODE_EXTENSIONS and path.is_file()


def collect_files(root: Path) -> List[str]:
    result: List[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in EXCLUDED_DIRS and not dirname.startswith(".")
        ]

        for filename in filenames:
            file_path = Path(dirpath) / filename
            if is_code_file(file_path):
                result.append(file_path.relative_to(ROOT).as_posix())

    return sorted(result, key=str.lower)


def tree_lines(entries: List[str]) -> List[str]:
    lines: List[str] = []

    def recurse(items: List[List[str]], depth: int) -> None:
        groups: dict[str, List[List[str]]] = {}
        for parts in items:
            head, *tail = parts
            groups.setdefault(head, []).append(tail)

        heads = sorted(groups.keys(), key=str.lower)
        for index, head in enumerate(heads):
            connector = "└── " if index == len(heads) - 1 else "├── "
            lines.append(f"{'    ' * depth}{connector}{head}")
            tails = [tail for tail in groups[head] if tail]
            if tails:
                recurse(tails, depth + 1)

    recurse([entry.split("/") for entry in entries], 0)
    return lines


def build_section(title: str, paths: List[str]) -> str:
    tree = "\n".join(tree_lines(paths)) if paths else "(无代码文件)"
    return f"""### {title}

```text
{tree}
```
"""


def build_content() -> str:
    top_level_code = [
        name
        for name in ["App.tsx", "index.js"]
        if (ROOT / name).exists()
    ]

    sections = [
        build_section("顶层入口", top_level_code),
        build_section("src/ - Feature-first 模块化源码", collect_files(ROOT / "src")),
        build_section("modules/ - Expo 本地原生模块", collect_files(ROOT / "modules")),
        build_section("android/app/src/ - Android 主工程源码", collect_files(ROOT / "android" / "app" / "src")),
    ]

    content = f"""# Architecture Snapshot

> 自动生成文件。运行 `python scripts/generate_architecture_snapshot.py` 刷新。
> 运行 `python scripts/generate_architecture_snapshot.py --check` 可验证快照是否与源码一致。
> 清单覆盖 `src/`、`modules/`、`android/app/src/` 和顶层入口文件。

{chr(10).join(sections)}
"""
    return content.rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="生成或校验架构快照。")
    parser.add_argument(
        "--check",
        action="store_true",
        help="快照与源码树不一致时返回失败，不写入文件。",
    )
    args = parser.parse_args()

    content = build_content()
    output_path = ROOT / "docs" / "architecture-snapshot.md"

    if args.check:
        if not output_path.exists() or output_path.read_text(encoding="utf-8") != content:
            print(
                "架构快照已过期，请运行 "
                "`python scripts/generate_architecture_snapshot.py`.",
                file=sys.stderr,
            )
            return 1
        print(f"架构快照已是最新：{output_path.relative_to(ROOT).as_posix()}")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8", newline="\n")
    print(f"已写入 {output_path.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
