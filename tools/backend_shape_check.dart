// Checks that the two implementations of the local-backend layer really do
// offer the same things.
//
// The program chooses between them with a conditional export:
//
//   export 'local_backend_stub.dart' if (dart.library.io) 'local_backend_io.dart';
//
// A browser build gets the stub, a desktop build gets the io implementation.
// The gate that starts the server (backend_gate.dart) is compiled against
// whichever one the target picks - and that is the trap: `flutter analyze`
// resolves a conditional export to its FIRST uri, so on a workstation the
// analysis always sees the stub. A constructor that exists only in the stub
// therefore passes analysis, passes a web build, and breaks the desktop build
// on the machine that compiles it. That happened once, with
// `LocalBackendStatus.unsupported`, and a whole Windows build was spent
// finding out.
//
// This check reads the three files and compares them directly, so the mistake
// is caught in a second instead of by a build on another operating system.
//
// Run it with either of:
//
//   dart run tools/backend_shape_check.dart
//   flutter pub run tools/backend_shape_check.dart
//
// It needs no Flutter, no database and no server: only the source files.

import 'dart:io';

int passed = 0;
int failed = 0;

void check(String name, bool condition, [String detail = '']) {
  if (condition) {
    passed++;
    stdout.writeln('  PASS  $name');
  } else {
    failed++;
    stdout.writeln('  FAIL  $name   $detail');
  }
}

void section(String title) => stdout.writeln('\n$title');

/// The repository root, found from this file's own place so the check works
/// from any working directory.
Directory findRoot() {
  final fromScript = File.fromUri(Platform.script).parent.parent;
  if (Directory('${fromScript.path}/lib/core/backend').existsSync()) return fromScript;
  if (Directory('lib/core/backend').existsSync()) return Directory.current;
  stderr.writeln('Could not find the repository root.');
  exit(2);
}

/// Constructors of a class, from the lines that declare them. A declaration
/// starts the line (possibly after `const`); every use is preceded by
/// `return`, `=` or a bracket, which keeps the two apart.
Set<String> constructorsOf(String source, String className) {
  final pattern = RegExp('^\\s*(?:const\\s+)?$className\\.(\\w+)\\(', multiLine: true);
  return pattern.allMatches(source).map((m) => m.group(1)!).toSet();
}

/// Static members of a class: methods, getters and fields.
Set<String> staticsOf(String source, String className) {
  final body = classBody(source, className);
  final names = <String>{};
  for (final match in RegExp(r'^\s*static\s+(?:[\w<>?,\s]+?)\s+(\w+)\s*[({;=]', multiLine: true)
      .allMatches(body)) {
    names.add(match.group(1)!);
  }
  for (final match in RegExp(r'^\s*static\s+[\w<>?,\s]+\s+get\s+(\w+)', multiLine: true)
      .allMatches(body)) {
    names.add(match.group(1)!);
  }
  return names;
}

/// Instance members a caller can read: fields and getters.
Set<String> membersOf(String source, String className) {
  final body = classBody(source, className);
  final names = <String>{};
  for (final match in RegExp(r'^\s*final\s+[\w<>?,\s]+\s+(\w+)\s*[;=]', multiLine: true)
      .allMatches(body)) {
    names.add(match.group(1)!);
  }
  for (final match in RegExp(r'^\s*[\w<>?,\s]+\s+get\s+(\w+)', multiLine: true).allMatches(body)) {
    names.add(match.group(1)!);
  }
  return names;
}

/// The text of one class, from its declaration to the line that closes it.
String classBody(String source, String className) {
  final start = RegExp('^\\s*class\\s+$className\\b', multiLine: true).firstMatch(source);
  if (start == null) return '';
  var depth = 0;
  var began = false;
  for (var i = start.end; i < source.length; i++) {
    final character = source[i];
    if (character == '{') {
      depth++;
      began = true;
    } else if (character == '}') {
      depth--;
      if (began && depth == 0) return source.substring(start.start, i + 1);
    }
  }
  return source.substring(start.start);
}

void main() {
  final root = findRoot();
  final directory = '${root.path}/lib/core/backend';
  final io = File('$directory/local_backend_io.dart').readAsStringSync();
  final stub = File('$directory/local_backend_stub.dart').readAsStringSync();
  final gate = File('$directory/backend_gate.dart').readAsStringSync();

  stdout.writeln('==============================================================');
  stdout.writeln('  KAYAN ERP  -  the two backend implementations, compared');
  stdout.writeln('==============================================================');

  section('[1] What the gate asks of a status');

  // Everything the gate names, taken from the gate itself: if the gate stops
  // using a member the check stops demanding it, and if it starts using a new
  // one the check demands it from both sides at once.
  final usedConstructors = RegExp(r'LocalBackendStatus\.(\w+)\(')
      .allMatches(gate)
      .map((m) => m.group(1)!)
      .toSet();
  final usedMembers = RegExp(r'\bstatus\.(\w+)').allMatches(gate).map((m) => m.group(1)!).toSet();
  final usedStatics = RegExp(r'LocalBackend\.(\w+)').allMatches(gate).map((m) => m.group(1)!).toSet();

  check('the gate names at least one status constructor', usedConstructors.isNotEmpty,
      'nothing to compare');
  check('the gate reads at least one field of a status', usedMembers.isNotEmpty);
  check('the gate calls at least one thing on LocalBackend', usedStatics.isNotEmpty);

  final ioConstructors = constructorsOf(io, 'LocalBackendStatus');
  final stubConstructors = constructorsOf(stub, 'LocalBackendStatus');
  final ioMembers = membersOf(io, 'LocalBackendStatus');
  final stubMembers = membersOf(stub, 'LocalBackendStatus');
  final ioStatics = staticsOf(io, 'LocalBackend');
  final stubStatics = staticsOf(stub, 'LocalBackend');

  section('[2] Every status constructor the gate uses exists on both sides');

  for (final name in usedConstructors.toList()..sort()) {
    final inIo = ioConstructors.contains(name);
    final inStub = stubConstructors.contains(name);
    check('LocalBackendStatus.$name', inIo && inStub,
        '${inIo ? '' : 'missing from the desktop implementation '} '
        '${inStub ? '' : 'missing from the web implementation'}');
  }

  section('[3] Every field of a status the gate reads exists on both sides');

  for (final name in usedMembers.toList()..sort()) {
    final inIo = ioMembers.contains(name);
    final inStub = stubMembers.contains(name);
    check('status.$name', inIo && inStub,
        '${inIo ? '' : 'missing from the desktop implementation '} '
        '${inStub ? '' : 'missing from the web implementation'}');
  }

  section('[4] Every LocalBackend member the gate calls exists on both sides');

  for (final name in usedStatics.toList()..sort()) {
    final inIo = ioStatics.contains(name) || ioMembers.contains(name) ||
        constructorsOf(io, 'LocalBackend').contains(name);
    final inStub = stubStatics.contains(name) || stubMembers.contains(name) ||
        constructorsOf(stub, 'LocalBackend').contains(name);
    check('LocalBackend.$name', inIo && inStub,
        '${inIo ? '' : 'missing from the desktop implementation '} '
        '${inStub ? '' : 'missing from the web implementation'}');
  }

  section('[5] Nothing the web side offers is missing from the desktop side');

  // The desktop implementation legitimately knows more than the stub: it can
  // report a server that came up, one that did not, and a database with nobody
  // in it, while the stub only ever answers "there is nothing to start here".
  // The mistake that matters runs the other way - a member the stub offers and
  // the desktop side does not, which is what broke the Windows build.
  final extraStub = stubConstructors.difference(ioConstructors);
  check('every status constructor the web side has, the desktop side has too',
      extraStub.isEmpty, extraStub.join(', '));

  final extraStubMembers = stubMembers.difference(ioMembers);
  check('every status field the web side has, the desktop side has too',
      extraStubMembers.isEmpty, extraStubMembers.join(', '));

  final extraStubStatics = stubStatics.difference(ioStatics).difference(ioMembers);
  check('every LocalBackend member the web side has, the desktop side has too',
      extraStubStatics.isEmpty, extraStubStatics.join(', '));

  stdout.writeln('\n==============================================================');
  stdout.writeln('  نجح: $passed    فشل: $failed');
  stdout.writeln('==============================================================\n');

  if (failed > 0) exit(1);
}
