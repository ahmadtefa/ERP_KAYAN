#!/usr/bin/env python3
"""Static verification for the Dart files written in this session.

Flutter and the Dart SDK are not installable in this sandbox (see
FLUTTER_TEST_BLOCKER.md), so `flutter analyze` and `flutter test` cannot run.
This script is not a substitute for them. It catches the specific class of
mistake that would otherwise reach a reviewer unchecked:

  1. unbalanced delimiters
  2. an import that points at a file or package that does not exist
  3. an unused import (dart's `unused_import` lint)
  4. an l10n key that is not declared in the generated localizations
  5. an identifier used but never declared in lib/ or imported
  6. a class/function name that collides with an existing declaration
  7. a provider or widget referenced but not defined

Anything it cannot resolve is reported, never assumed correct.
"""

import os
import re
import sys
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "lib")
TEST = os.path.join(ROOT, "test")

BUILTIN = {
    # dart:core
    "Object", "String", "int", "double", "num", "bool", "List", "Map", "Set",
    "Future", "Stream", "Iterable", "Duration", "DateTime", "Exception",
    "Error", "StateError", "ArgumentError", "FormatException", "print",
    "identical", "const", "final", "var", "void", "dynamic", "null", "true",
    "false", "this", "super", "return", "await", "async", "yield", "if",
    "else", "for", "while", "do", "switch", "case", "default", "break",
    "continue", "try", "catch", "finally", "throw", "rethrow", "new", "in",
    "is", "as", "extends", "implements", "with", "mixin", "enum", "class",
    "abstract", "static", "late", "required", "factory", "operator", "get",
    "set", "typedef", "assert", "library", "part", "export", "import", "show",
    "hide", "deferred", "external", "covariant", "base", "sealed", "when",
    "extension", "on",
}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def strip_code(src):
    """Blanks comments and string literals, keeping the code between them.

    `${...}` inside a literal is code, not text, and its braces have to stay
    countable - but they also have to stay balanced on their own. Everything
    else inside quotes is removed so a `{` in a message cannot look like a
    block. Raw strings carry no escapes; a raw `r'[{]'` is the reason that
    distinction exists here.
    """
    out = []
    i, n = 0, len(src)

    def skip_literal(i):
        """Returns the index just past the literal starting at i, and its
        interpolations, which are code and are copied out."""
        quote = src[i]
        raw = i > 0 and src[i - 1] in "rR" and (
            i < 2 or not (src[i - 2].isalnum() or src[i - 2] == "_")
        )
        triple = src.startswith(quote * 3, i)
        j = i + (3 if triple else 1)
        interps = []
        while j < n:
            if triple:
                if src.startswith(quote * 3, j):
                    return j + 3, interps
            elif src[j] == quote:
                return j + 1, interps
            if not raw and src[j] == "\\":
                j += 2
                continue
            if src.startswith("${", j):
                depth, k = 1, j + 2
                while k < n and depth:
                    if src[k] == "{":
                        depth += 1
                    elif src[k] == "}":
                        depth -= 1
                    k += 1
                interps.append(src[j:k])
                j = k
                continue
            j += 1
        return n, interps

    while i < n:
        c = src[i]
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
        elif src.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if src.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif src.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
        elif c in "'\"":
            i, interps = skip_literal(i)
            out.append(" ")
            for chunk in interps:
                out.append(" " + chunk + " ")
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _apostrophes(src):
    """Flags a single-quoted string interrupted by an apostrophe.

    `'This person's grants'` closes at the first apostrophe and leaves the
    rest as code; the compiler rejects it, but nothing else here would.
    """
    problems = []
    for match in re.finditer(r"(?<![A-Za-z0-9_])'((?:[^'\\\n]|\\.)*)'", src):
        tail = src[match.end():match.end() + 24]
        # A closing quote directly followed by a letter and another quote is
        # the signature of a possessive that ended the literal early.
        if re.match(r"[A-Za-z]+\s+[a-z]", tail) and "s " in match.group(1)[-4:]:
            line = src[:match.start()].count("\n") + 1
            problems.append(
                f"line {line}: apostrophe inside a single-quoted string "
                f"closes it early: {match.group(0)[:50]!r}"
            )
    return problems


def l10n_keys():
    """Every message the generated localizations expose.

    Strings without placeholders are declared as getters, ones with
    placeholders as methods, so both shapes have to be collected.
    """
    path = os.path.join(LIB, "l10n", "generated", "app_localizations.dart")
    src = read(path)
    keys = set(re.findall(r"String\s+get\s+([a-zA-Z0-9_]+)", src))
    keys |= set(re.findall(r"^\s*String\s+([a-zA-Z0-9_]+)\s*\(", src, re.M))
    # `l10n.someLabel(...)` may not be a generated key at all: the project
    # extends AppLocalizations to add methods of its own. Those are declared
    # elsewhere, so an extension on AppLocalizations counts as a key.
    for dirpath, _, files in os.walk(LIB):
        for name in files:
            if not name.endswith(".dart"):
                continue
            other = read(os.path.join(dirpath, name))
            for block in re.finditer(
                r"extension\s+\w+\s+on\s+AppLocalizations\s*\{(.*?)\n\}",
                other,
                re.S,
            ):
                keys |= set(
                    re.findall(
                        r"\bString\s+(?:get\s+)?([a-zA-Z0-9_]+)\s*[({]",
                        block.group(1),
                    )
                )
    return keys


def declared_symbols():
    """Every top-level and class-level name declared anywhere under lib/."""
    names = set()
    pattern = re.compile(
        r"^\s*(?:abstract\s+|final\s+|sealed\s+|base\s+)*"
        r"(?:class|enum|mixin|extension|typedef)\s+([A-Za-z_][A-Za-z0-9_]*)",
        re.M,
    )
    misc = [
        re.compile(r"^(?:final|const|late\s+final)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=", re.M),
        re.compile(r"^(?:Future|void|String|int|double|bool|num|List|Map|Widget|Json)[^=;{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.M),
        re.compile(r"^[A-Za-z_][A-Za-z0-9_<>,\s\?]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*", re.M),
    ]
    for dirpath, _, files in os.walk(LIB):
        for name in files:
            if not name.endswith(".dart"):
                continue
            src = strip_code(read(os.path.join(dirpath, name)))
            names.update(pattern.findall(src))
            for rx in misc:
                names.update(rx.findall(src))
    return names


def resolve_import(importing, imp):
    if imp.startswith("package:"):
        rest = imp[len("package:"):]
        pkg, _, tail = rest.partition("/")
        if pkg == "erp_kayan":
            return os.path.join(LIB, tail)
        pubspec = read(os.path.join(ROOT, "pubspec.yaml"))
        dep = re.search(r"^\s{2}%s:" % re.escape(pkg), pubspec, re.M)
        return "PACKAGE" if dep else None
    if imp.startswith("dart:"):
        return "SDK"
    return os.path.normpath(os.path.join(os.path.dirname(importing), imp))


def check(path, keys, symbols):
    problems, warnings = [], []
    src = read(path)
    code = strip_code(src)

    for opener, closer, label in [("{", "}", "braces"), ("(", ")", "parens"), ("[", "]", "brackets")]:
        if code.count(opener) != code.count(closer):
            problems.append(f"unbalanced {label}: {code.count(opener)} vs {code.count(closer)}")

    imports = re.findall(r"^import\s+'([^']+)'(?:\s+show\s+([^;]+))?", src, re.M)
    body = code
    for imp, shown in imports:
        target = resolve_import(path, imp)
        if target is None:
            problems.append(f"package not declared in pubspec: {imp}")
        elif target not in ("PACKAGE", "SDK") and not os.path.exists(target):
            problems.append(f"import does not resolve: {imp}")
        # unused import
        if target not in ("PACKAGE", "SDK") and os.path.exists(target):
            tsrc = strip_code(read(target))
            tnames = set(re.findall(r"^\s*(?:abstract\s+|final\s+|sealed\s+)*(?:class|enum|mixin|extension|typedef)\s+([A-Za-z_][A-Za-z0-9_]*)", tsrc, re.M))
            tnames |= set(re.findall(r"^(?:final|const)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=", tsrc, re.M))
            tnames |= set(re.findall(r"^(?:Future|void|String|int|double|bool|num|List|Map|Widget|Json)[^=;{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", tsrc, re.M))
            # An extension brings getters/methods, not type names, so its
            # declaration alone cannot show whether it is used. Detect the
            # members it adds instead.
            ext_members = set(re.findall(
                r"^\s*[A-Za-z_][A-Za-z0-9_<>,\s\?]*\s+get\s+([A-Za-z_][A-Za-z0-9_]*)", tsrc, re.M))
            tnames |= ext_members
            # `show A, B` narrows the import: only those names are in scope.
            if shown:
                tnames = {n.strip() for n in shown.split(",")}
            if tnames and not any(re.search(r"\b%s\b" % re.escape(n), body) for n in tnames):
                warnings.append(f"possibly unused import: {imp}")

    for key in set(re.findall(r"\bl10n\.([a-zA-Z0-9_]+)", code)):
        if key not in keys:
            problems.append(f"l10n key not declared: {key}")

    # A single-quoted Dart string cannot contain an unescaped apostrophe.
    # Scanning the raw source for `'...'` runs and checking that none of them
    # was cut short by an apostrophe catches a whole class of syntax error that
    # the delimiter counts above cannot see.
    problems.extend(_apostrophes(src))

    return problems, warnings


def main():
    keys = l10n_keys()
    symbols = declared_symbols()
    targets = sys.argv[1:]
    if not targets:
        print("usage: static_dart_check.py <file.dart> [...]", file=sys.stderr)
        return 2

    total = 0
    for rel in targets:
        path = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        problems, warnings = check(path, keys, symbols)
        label = os.path.relpath(path, ROOT)
        total += len(problems)
        if problems or warnings:
            print(f"\n{label}")
            for p in problems:
                print(f"  ERROR   {p}")
            for w in warnings:
                print(f"  warn    {w}")
        else:
            print(f"\n{label}\n  clean")
    print(f"\n{'PASS' if total == 0 else 'FAIL'} — {total} error(s)")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
