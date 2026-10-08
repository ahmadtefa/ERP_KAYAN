// Checks the desktop launcher for real: it starts the packaged server the way
// a Windows copy does, waits for the health route, signs in through the address
// it returned, then stops it again and proves nothing is left listening.
//
// Run it the way a packaged copy would be laid out:
//
//   KAYAN_DESKTOP_BACKEND_DIR=$PWD/backend \
//   KAYAN_DESKTOP_NODE=$(which node) \
//   /opt/flutter/bin/flutter pub run tools/desktop_check.dart
//
// It exercises the same code the Windows build runs - local_backend_io.dart -
// on whatever machine it is started on. What it cannot exercise is the Windows
// window, the hidden console and the packaging script; those are covered in
// docs/DESKTOP_WINDOWS.md under Verification.

import 'dart:convert';
import 'dart:io';

import 'package:erp_kayan/core/backend/local_backend_io.dart';

int passed = 0;
int failed = 0;

void section(String title) => stdout.writeln('\n$title');

void check(String name, bool condition, [String detail = '']) {
  if (condition) {
    passed++;
    stdout.writeln('  PASS  $name');
  } else {
    failed++;
    stdout.writeln('  FAIL  $name   $detail');
  }
}

/// Signs in through the address the launcher returned, which proves that
/// address really is a working API and not merely something that says "hello"
/// on a port.
Future<(int, Map<String, dynamic>)> signIn(String baseUrl) async {
  final client = HttpClient();
  try {
    final request = await client.postUrl(Uri.parse('$baseUrl/auth/login'));
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode({'username': 'admin', 'password': 'Admin@12345'}));
    final response = await request.close();
    final body = await response.transform(utf8.decoder).join();
    return (response.statusCode, jsonDecode(body) as Map<String, dynamic>);
  } finally {
    client.close(force: true);
  }
}

Future<bool> portAnswers(int port, {Duration wait = const Duration(seconds: 3)}) async {
  try {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    final request =
        await client.getUrl(Uri.parse('http://127.0.0.1:$port/api/v1/health'));
    final response = await request.close().timeout(wait);
    await response.drain<void>();
    client.close(force: true);
    return response.statusCode == 200;
  } on Object {
    return false;
  }
}

Future<bool> portFree(int port) async {
  try {
    final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
    await socket.close();
    return true;
  } on SocketException {
    return false;
  }
}

int countOf(String text, String needle) => needle.allMatches(text).length;

Future<void> main() async {
  stdout.writeln('=' * 70);
  stdout.writeln('  KAYAN  -  التشغيل على ويندوز: المشغّل اللي بيشغّل السيرفر مع البرنامج');
  stdout.writeln('=' * 70);

  final layout = BackendLayout.discover();

  // This check is about starting a server where there is none. A server that is
  // already running (a developer's own, for instance) would be adopted instead,
  // which is correct behaviour but is not what is being measured here.
  for (final port in LocalBackend.candidatePorts) {
    if (await portAnswers(port)) {
      stdout.writeln('\n  فيه سيرفر شغال بالفعل على المنفذ $port.');
      stdout.writeln('  اقفله الأول (الأداة بتقيس التشغيل من الصفر) وشغّل الفحص تاني.');
      exit(2);
    }
  }

  // ─────────────────────────────────────────────────── 1. the pieces exist
  section('[1] مكوّنات البرنامج في مكانها');
  check('مجلد السيرفر موجود', Directory(layout.backendDirectory).existsSync(),
      layout.backendDirectory);
  check('نقطة الدخول موجودة', File(layout.entryPoint).existsSync(), layout.entryPoint);
  check('مفيش مشكلة في مسارات البرنامج', layout.problem == null, '${layout.problem}');
  stdout.writeln('      مجلد بيانات الجهاز: ${layout.dataDirectory.path}');
  stdout.writeln('      ملف السجل: ${layout.logPath}');

  // ─────────────────────────────────────── 2. start and wait for readiness
  section('[2] تشغيل السيرفر والانتظار لحد ما يبقى جاهز');
  final clock = Stopwatch()..start();
  final first = await LocalBackend.ensureRunning(appDisplayName: 'KAYAN ERP');
  clock.stop();
  check('الخادم بقى جاهز', first.isReady, '${first.problem}');
  if (!first.isReady) {
    final tail = await layout.logTail(lines: 30);
    stdout.writeln(tail.split('\n').map((l) => '      $l').join('\n'));
    stdout.writeln('\n  نجح: $passed    فشل: $failed');
    exit(1);
  }
  final port = Uri.parse(first.baseUrl!).port;
  stdout.writeln('      العنوان: ${first.baseUrl}   خلال ${clock.elapsedMilliseconds} ms');
  check('العنوان على 127.0.0.1 بس', first.baseUrl!.startsWith('http://127.0.0.1:'));
  check('مضيّعش وقت زيادة عن 90 ثانية',
      clock.elapsedMilliseconds < 90000, '${clock.elapsedMilliseconds} ms');

  final logAfterStart = await layout.logTail(lines: 400);
  final listensSoFar = countOf(logAfterStart, 'API listening on');

  // ───────────────────────────────────── 3. the address is a real API
  section('[3] عنوان حقيقي: دخول فعلي ببيانات المستخدم');
  final (code, body) = await signIn(first.baseUrl!);
  check('الدخول نجح من العنوان اللي رجّعه المشغّل', code == 200 || code == 201,
      'status=$code');
  check('رجع توكن حقيقي', (body['accessToken'] as String?)?.isNotEmpty ?? false,
      body.keys.join(','));

  // ─────────────────────────────── 4. two copies never start two servers
  section('[4] مايشغّلش سيرفر تاني لو فيه واحد شغال');
  final second = await LocalBackend.ensureRunning(appDisplayName: 'KAYAN ERP');
  check('النداء التاني رجّع نفس العنوان', second.baseUrl == first.baseUrl,
      '${second.baseUrl}');
  check('مافيش سيرفر تاني اتشغّل',
      countOf(await layout.logTail(lines: 400), 'API listening on') == listensSoFar);

  // ─────────────────────────────────────── 5. the machine's settings
  section('[5] إعدادات الجهاز');
  final settings = layout.settingsFile;
  check('ملف الإعدادات موجود', await settings.exists(), settings.path);
  if (await settings.exists()) {
    final text = await settings.readAsString();
    check('فيه DATABASE_URL', text.contains('DATABASE_URL='));
    check('فيه مفاتيح توقيع متولّدة على الجهاز', text.contains('JWT_ACCESS_SECRET="'));
    check('المفاتيح مش فاضية', !text.contains('JWT_ACCESS_SECRET=""'));
  final seeded = await RuntimeSettings.load(layout, 3000);
  check('المشغّل بيقرا الإعدادات اللي على الجهاز',
      seeded.databaseUrl == 'postgresql://erp_app:erp_app_pass@127.0.0.1:5432'
          '/erp_kayan?schema=public',
      '${seeded.databaseUrl}');
  }
  check('باسورد تطوير مش متسجّل في ملف الإعدادات',
      !(await settings.readAsString()).contains('Admin@12345'));

  // The file above was placed by the machine's setup. This is what the program
  // itself writes on a machine that has never run it.
  final fresh = Directory.systemTemp.createTempSync('kayan-first-run');
  final freshLayout = BackendLayout(
    backendDirectory: layout.backendDirectory,
    nodeExecutable: layout.nodeExecutable,
    entryPoint: layout.entryPoint,
    dataDirectory: fresh,
    logPath: '${fresh.path}${Platform.pathSeparator}logs'
        '${Platform.pathSeparator}backend.log',
  );
  final generated = await RuntimeSettings.load(freshLayout, 3000);
  final generatedText = await freshLayout.settingsFile.readAsString();
  check('من أول تشغيل بيكتب ملف إعدادات', await freshLayout.settingsFile.exists());
  check('بيبعت المستخدم لملف الإعدادات',
      generatedText.contains('close the program completely'));
  check('المفاتيح في الملف الجديد متولّدة ومش فاضية',
      !generatedText.contains('JWT_ACCESS_SECRET=""') &&
          generatedText.contains('JWT_ACCESS_SECRET="'));
  check('الإعدادات الجديدة فيها عنوان قاعدة البيانات',
      generated.databaseUrl?.startsWith('postgresql://') ?? false,
      '${generated.databaseUrl}');
  fresh.deleteSync(recursive: true);

  // ─────────────────────────────────────────────── 6. clean shutdown
  section('[6] الإغلاق النظيف: مفيش سيرفر بيفضل شغال');
  await LocalBackend.shutdown();
  await Future<void>.delayed(const Duration(seconds: 3));
  check('المنفذ $port بقى مقفول', !await portAnswers(port), 'لسه بيرد');
  check('المنفذ $port بقى حرّ', await portFree(port));
  check('مفيش عملية محفوظة', LocalBackend.instance == null);

  final log = await layout.logTail(lines: 12);
  check('السجل فيه سطور من السيرفر بصيغة مقروءة', log.contains('[out] '),
      log.split('\n').first);
  check('السجل مافيهوش أكواد ألوان', !log.contains('\x1B['));
  check('السجل سجّل إنه وقف السيرفر', log.contains('[shell] stopping the server'));

  // ────────────── 7. port 3000 taken by something else: use the next one
  section('[7] لو 3000 ماخوذ من برنامج تاني، بيختار منفذ فاضي');
  ServerSocket? squatter;
  try {
    squatter = await ServerSocket.bind(InternetAddress.loopbackIPv4, 3000);
  } on SocketException {
    stdout.writeln('      3000 ماخوذ أصلاً - هنكمل على ده');
  }
  final elsewhere = await LocalBackend.ensureRunning(appDisplayName: 'KAYAN ERP');
  check('طلع جاهز على منفذ تاني', elsewhere.isReady, '${elsewhere.problem}');
  check('مش 3000', elsewhere.baseUrl != null && !elsewhere.baseUrl!.endsWith(':3000/api/v1'),
      '${elsewhere.baseUrl}');
  final (code2, _) = elsewhere.baseUrl == null ? (0, <String, dynamic>{})
      : await signIn(elsewhere.baseUrl!);
  check('والدخول شغال عليه كمان', code2 == 200 || code2 == 201, 'status=$code2');
  await LocalBackend.shutdown();
  await Future<void>.delayed(const Duration(seconds: 2));
  await squatter?.close();

  // ──────── 8. someone else's copy is used as it is, and left alone
  section('[8] لو فيه نسخة تانية شغالة، بيستعملها ومايقفلهاش');
  final settingsForExternal = await RuntimeSettings.load(layout, 3000);
  final external = await Process.start(
    layout.nodeExecutable,
    [layout.entryPoint],
    workingDirectory: layout.backendDirectory,
    environment: {
      ...settingsForExternal.asEnvironment(3000),
      'HOST': '127.0.0.1',
      'NODE_ENV': 'production',
      'NO_COLOR': '1',
    },
    includeParentEnvironment: true,
  );
  external.stdout.drain<void>();
  external.stderr.drain<void>();
  var externalUp = false;
  for (var i = 0; i < 60 && !externalUp; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    externalUp = await portAnswers(3000);
  }
  check('النسخة الخارجية اشتغلت على 3000', externalUp);
  if (externalUp) {
    final adopted = await LocalBackend.ensureRunning(appDisplayName: 'KAYAN ERP');
    check('المشغّل استعمل العنوان الموجود', adopted.baseUrl == 'http://127.0.0.1:3000/api/v1',
        '${adopted.baseUrl}');
    await LocalBackend.shutdown();
    await Future<void>.delayed(const Duration(seconds: 2));
    check('ماقفلش سيرفر مش بتاعه', await portAnswers(3000), 'اتقفل بالغلط');
  }
  external.kill(ProcessSignal.sigterm);
  await external.exitCode.timeout(const Duration(seconds: 10), onTimeout: () {
    external.kill(ProcessSignal.sigkill);
    return -9;
  });

  // ─────────────────────────────────────────────────────────────────
  stdout.writeln('\n${'=' * 70}');
  stdout.writeln('  نجح: $passed    فشل: $failed');
  stdout.writeln('=' * 70);
  exit(failed == 0 ? 0 : 1);
}
