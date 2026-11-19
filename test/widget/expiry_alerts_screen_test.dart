import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/expiry_alerts_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/state_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// A user who may read the feed and ask for a scan.
const _storeManager = AppUser(
  id: 'u1',
  username: 'manager',
  fullName: 'Store manager',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'inventory.batches.read',
    'inventory.batches.writeoff',
    'notifications.manage',
  ],
);

/// A reader: may see the alerts, may not make the scanner run and may not
/// write a lot off.
const _reader = AppUser(
  id: 'u2',
  username: 'viewer',
  fullName: 'Viewer',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['inventory.batches.read'],
);

Json _row({
  String id = 'lot-1',
  String batchNumber = 'LOT-A',
  String itemNameEn = 'Milk',
  String itemNameAr = 'حليب',
  String group = 'EXPIRING_SOON',
  int days = 5,
  String quantity = '12.0000',
  String? expiry = '2026-03-06T00:00:00.000Z',
  String? production = '2026-01-01T00:00:00.000Z',
  Json? location = const {
    'id': 'loc-1',
    'code': 'A-01',
    'nameEn': 'Aisle A shelf 1',
    'nameAr': 'ممر أ رف ١',
  },
  Json? alert = const {'status': 'OPEN', 'severity': 'WARNING', 'raisedCount': 1},
}) => {
  'id': id,
  'batchNumber': batchNumber,
  'itemId': 'item-1',
  'itemCode': 'I-1',
  'itemNameEn': itemNameEn,
  'itemNameAr': itemNameAr,
  'unit': 'L',
  'warehouseId': 'wh-1',
  'warehouseCode': 'MAIN',
  'warehouseNameEn': 'Main store',
  'warehouseNameAr': 'الرئيسي',
  'storageLocation': location,
  'productionDate': production,
  'expiryDate': expiry,
  'daysToExpiry': days,
  'band': group == 'EXPIRED' ? 'EXPIRED' : 'IN_7',
  'group': group,
  'status': 'OPEN',
  'quantity': quantity,
  'unitCost': '2.0000',
  'value': '24.0000',
  'alert': alert,
};

class _AlertsApi extends ApiClient {
  _AlertsApi({this.rows, this.failure, this.scanFailure})
    : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore()) {
    // The real client's own error path, reached through a real adapter. A
    // hand-rolled `get` override would hide the failure the screen is being
    // tested against, which is exactly how an error-state test passes without
    // ever seeing an error.
    raw.httpClientAdapter = _Adapter(this);
  }

  final List<Json>? rows;

  /// Thrown instead of answering, so the error state can be driven.
  final Object? failure;

  /// Thrown only when the request asked for a scan.
  final Object? scanFailure;

  /// Completes one request. Left pending by the spinner test so the first frame
  /// is unambiguously "in flight" rather than "already answered".
  Completer<void>? gate;

  /// Every `/inventory/batches/alerts` call, so the test can prove a refresh
  /// actually went back to the server instead of reusing what it already had.
  final calls = <Map<String, dynamic>?>[];

  int get scanCalls => calls.where((query) => query?['scan'] == 'true').length;

  Map<String, dynamic> answerFor(Map<String, dynamic>? query) {
    calls.add(query);
    if (failure != null) throw failure!;
    if (query?['scan'] == 'true' && scanFailure != null) throw scanFailure!;
    final items = rows ?? [_row()];
    return {
      'asOf': '2026-03-01',
      'days': [7, 30, 60, 90],
      'horizonDays': 90,
      'counts': {
        'expired': items.where((row) => row['group'] == 'EXPIRED').length,
        'expiringSoon': items.where((row) => row['group'] == 'EXPIRING_SOON').length,
        'valid': items.where((row) => row['group'] == 'VALID').length,
        'total': items.length,
      },
      'items': items,
    };
  }
}

/// Answers every request from [_AlertsApi]'s fixture.
class _Adapter implements HttpClientAdapter {
  _Adapter(this.api);

  final _AlertsApi api;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path != '/inventory/batches/alerts') {
      return ResponseBody.fromString('{}', 200, headers: _jsonHeaders);
    }
    final pending = api.gate;
    if (pending != null) await pending.future;
    final query = options.queryParameters.map(
      (key, value) => MapEntry(key, '$value'),
    );
    try {
      final body = api.answerFor(query);
      return ResponseBody.fromString(jsonEncode(body), 200, headers: _jsonHeaders);
    } on Failure catch (error) {
      // What the real server would send for a refusal, so the client's own
      // translator runs and the screen shows a server sentence.
      final status = error is ApiFailure ? (error.statusCode ?? 400) : 400;
      return ResponseBody.fromString(
        jsonEncode({'message': error.message}),
        status,
        headers: _jsonHeaders,
      );
    }
  }

  static const _jsonHeaders = {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  };

  @override
  void close({bool force = false}) {}
}

void main() {
  Future<void> pump(
    WidgetTester tester,
    _AlertsApi api, {
    AppUser user = _storeManager,
    Locale locale = const Locale('en'),
  }) async {
    tester.view.physicalSize = const Size(1900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(user),
        ],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ExpiryAlertsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('the feed', () {
    testWidgets('shows the item, batch, dates, quantity, warehouse and shelf', (
      tester,
    ) async {
      await pump(tester, _AlertsApi(rows: [_row()]));

      expect(find.text('Milk'), findsOneWidget);
      expect(find.text('LOT-A'), findsOneWidget);
      expect(find.text('2026-01-01'), findsOneWidget);
      expect(find.text('2026-03-06'), findsOneWidget);
      expect(find.text('12.0000'), findsOneWidget);
      expect(find.text('Main store'), findsOneWidget);
      expect(find.text('Aisle A shelf 1'), findsOneWidget);
      // The alert column reads the notification row, not the dates.
      expect(find.text('Open'), findsOneWidget);
    });

    testWidgets('says "no alert" when the scanner has not raised the lot', (
      tester,
    ) async {
      await pump(tester, _AlertsApi(rows: [_row(alert: null)]));

      expect(find.text('No alert'), findsOneWidget);
      expect(find.text('Open'), findsNothing);
    });

    testWidgets('a lot with no shelf shows a dash, not null', (tester) async {
      await pump(tester, _AlertsApi(rows: [_row(location: null)]));

      expect(find.textContaining('null'), findsNothing);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('Arabic reads the Arabic item, warehouse and shelf names', (
      tester,
    ) async {
      await pump(
        tester,
        _AlertsApi(
          rows: [
            _row(
              location: const {
                'id': 'loc-1',
                'code': 'A-01',
                'nameEn': 'Aisle A shelf 1',
                'nameAr': 'ممر أ رف ١',
              },
            ),
          ],
        ),
        locale: const Locale('ar'),
      );

      expect(find.text('حليب'), findsOneWidget);
      expect(find.text('الرئيسي'), findsOneWidget);
      expect(find.text('ممر أ رف ١'), findsOneWidget);
      expect(find.text('Milk'), findsNothing);
      expect(find.text('المتبقي'), findsOneWidget);
    });
  });

  group('the three tabs', () {
    testWidgets('starts on expiring soon and counts every group', (tester) async {
      await pump(
        tester,
        _AlertsApi(
          rows: [
            _row(id: 'expired', batchNumber: 'LOT-X', group: 'EXPIRED', days: -3),
            _row(id: 'soon', batchNumber: 'LOT-A', group: 'EXPIRING_SOON'),
            _row(id: 'good', batchNumber: 'LOT-G', group: 'VALID', days: 200),
          ],
        ),
      );

      // The counts are the server's, shown on the chips.
      expect(find.text('1'), findsNWidgets(3));
      // The default tab is the one that needs action soonest.
      expect(find.text('LOT-A'), findsOneWidget);
      expect(find.text('LOT-X'), findsNothing);
      expect(find.text('LOT-G'), findsNothing);
    });

    testWidgets('the expired tab lists only the expired lot', (tester) async {
      await pump(
        tester,
        _AlertsApi(
          rows: [
            _row(id: 'expired', batchNumber: 'LOT-X', group: 'EXPIRED', days: -3),
            _row(id: 'soon', batchNumber: 'LOT-A', group: 'EXPIRING_SOON'),
          ],
        ),
      );

      await tester.tap(find.text('Expired'));
      await tester.pumpAndSettle();

      expect(find.text('LOT-X'), findsOneWidget);
      expect(find.text('LOT-A'), findsNothing);
    });

    testWidgets('the valid tab lists the lots with time left', (tester) async {
      await pump(
        tester,
        _AlertsApi(
          rows: [
            _row(id: 'soon', batchNumber: 'LOT-A', group: 'EXPIRING_SOON'),
            _row(id: 'good', batchNumber: 'LOT-G', group: 'VALID', days: 200),
          ],
        ),
      );

      await tester.tap(find.text('Valid'));
      await tester.pumpAndSettle();

      expect(find.text('LOT-G'), findsOneWidget);
      expect(find.text('LOT-A'), findsNothing);
    });

    testWidgets('an empty tab says so instead of showing a blank table', (
      tester,
    ) async {
      await pump(
        tester,
        _AlertsApi(rows: [_row(group: 'EXPIRING_SOON')]),
      );

      await tester.tap(find.text('Expired'));
      await tester.pumpAndSettle();

      expect(find.text('No expired lots.'), findsOneWidget);
    });
  });

  group('refresh', () {
    testWidgets('the refresh button goes back to the server', (tester) async {
      final api = _AlertsApi(rows: [_row()]);
      await pump(tester, api);
      final before = api.calls.length;
      expect(before, greaterThan(0));

      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();

      expect(
        api.calls.length,
        greaterThan(before),
        reason: 'a refresh that reused the cached answer would show stock the '
            'server no longer holds',
      );
    });

    testWidgets('scan now asks the server to scan, then reloads', (
      tester,
    ) async {
      final api = _AlertsApi(rows: [_row()]);
      await pump(tester, api);

      await tester.tap(find.text('Scan now'));
      await tester.pumpAndSettle();

      expect(api.scanCalls, 1);
      // And the list was read again afterwards, not left as it was.
      expect(api.calls.length, greaterThanOrEqualTo(2));
      expect(find.text('Expiry scan finished.'), findsOneWidget);
    });

    testWidgets('a reader is not offered the scan button at all', (
      tester,
    ) async {
      final api = _AlertsApi(rows: [_row()]);
      await pump(tester, api, user: _reader);

      expect(find.text('Scan now'), findsNothing);
      // Reading still works.
      expect(find.text('LOT-A'), findsOneWidget);
    });

    testWidgets('a refused scan is reported as the server worded it', (
      tester,
    ) async {
      final api = _AlertsApi(
        rows: [_row()],
        scanFailure: const ApiFailure('Scanning is not allowed', statusCode: 403),
      );
      await pump(tester, api);

      await tester.tap(find.text('Scan now'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Scanning is not allowed'), findsOneWidget);
      // The list is still there: a failed scan is not a failed screen.
      expect(find.text('LOT-A'), findsOneWidget);
    });
  });

  group('loading, error and empty', () {
    testWidgets('shows a spinner while the first answer is in flight', (
      tester,
    ) async {
      final api = _AlertsApi(rows: [_row()])..gate = Completer<void>();
      tester.view.physicalSize = const Size(1900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(_storeManager),
          ],
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: ExpiryAlertsScreen()),
          ),
        ),
      );
      // The request is held open, so this frame is unambiguously "in flight".
      await tester.pump();
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      api.gate?.complete();
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
      // And the answer that arrived is the one on screen.
      expect(find.text('LOT-A'), findsOneWidget);
    });

    testWidgets('a failure shows the error with a retry that reloads', (
      tester,
    ) async {
      final api = _AlertsApi(failure: const ApiFailure('Server unavailable'));
      await pump(tester, api);

      // The app does not show a raw failure string: it maps the failure to a
      // sentence the operator can act on, so the assertion is that a real
      // error view appeared rather than that a spinner or an empty table did.
      expect(find.byType(ErrorView), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.byType(DataTable), findsNothing);

      final before = api.calls.length;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(
        api.calls.length,
        greaterThan(before),
        reason: 'retry must ask the server again rather than redraw the error',
      );
    });

    testWidgets('nothing to alert on says so plainly', (tester) async {
      await pump(tester, _AlertsApi(rows: const []));

      expect(
        find.textContaining('Nothing to alert on'),
        findsOneWidget,
      );
      expect(find.byType(DataTable), findsNothing);
    });

    testWidgets('a user without the read grant sees the empty state, not an error', (
      tester,
    ) async {
      final api = _AlertsApi(rows: [_row()]);
      await pump(
        tester,
        api,
        user: const AppUser(
          id: 'u3',
          username: 'nobody',
          fullName: 'Nobody',
          companyId: 'company-1',
        ),
      );

      expect(find.textContaining('Nothing to alert on'), findsOneWidget);
      // No request was made: the server would have refused it.
      expect(api.calls, isEmpty);
    });
  });
}
