/// The operator window itself: four tabs, and the state a first run is in.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/main.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:kayan_key_generator/src/keys.dart';
import 'package:path/path.dart' as p;

import 'support/memory_key_folder.dart';

Map<String, dynamic> _golden() => Map<String, dynamic>.from(
      jsonDecode(File(p.join('test', 'goldens', 'vectors.json')).readAsStringSync()) as Map,
    );

void main() {
  late Directory home;

  setUp(() {
    home = Directory.systemTemp.createTempSync('kayan-ui-');
  });

  tearDown(() {
    try {
      home.deleteSync(recursive: true);
    } catch (_) {
      // A temp folder left behind is not a failure.
    }
  });

  testWidgets('a first run says there is no key and offers the key tab', (tester) async {
    final state = OperatorState(KeyFolder(home.path));
    await state.refresh();
    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pumpAndSettle();

    expect(find.text('مولّد مفاتيح كيان'), findsOneWidget);
    expect(find.textContaining('لا يوجد مفتاح توقيع'), findsOneWidget);
    expect(find.text('إصدار'), findsOneWidget);
    expect(find.text('السجل'), findsOneWidget);
    expect(find.text('فحص'), findsOneWidget);
    expect(find.text('المفتاح'), findsOneWidget);
  });

  testWidgets('with a key and a licence, the issue tab offers both', (tester) async {
    final golden = _golden();
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);

    late OperatorState state;
    // Real register files and crypto; the synthetic private key remains in
    // memory. Disk/crypto work uses runAsync because widget timers are fake.
    await tester.runAsync(() async {
      final key = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
      state = OperatorState(MemoryKeyFolder(home.path, key));
      await state.generator.createLicence(ref: 'شركة النور', seats: 5, term: '1y');
      await state.refresh();
    });

    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    // A widget in this tab keeps a frame scheduled, so pumpAndSettle would
    // exhaust its ten-minute budget; the assertions are about content.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.textContaining('989A-6539'), findsOneWidget); // the fingerprint
    expect(find.textContaining('شركة النور'), findsOneWidget); // the licence in the dropdown
    expect(find.text('إصدار'), findsWidgets);
  });

  testWidgets('the key tab shows the folder it uses', (tester) async {
    final state = OperatorState(KeyFolder(home.path));
    await state.refresh();
    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pumpAndSettle();

    await tester.tap(find.text('المفتاح'));
    await tester.pumpAndSettle();
    expect(find.textContaining('استيراد'), findsWidgets);
    expect(find.textContaining(home.path), findsOneWidget);
    expect(find.byType(Scaffold), findsWidgets);
  });
}
