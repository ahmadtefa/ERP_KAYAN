import 'dart:convert';
import 'dart:io';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart'
    as auth;
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    as data;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The links behind every download and print button.
///
/// These URLs are opened by the browser itself, as a navigation that cannot
/// carry an Authorization header — so each one carries a one-minute download
/// ticket minted by the server for the occasion. What it must not carry is
/// the sign-in token: an address ends up in browser history, in proxy logs
/// and in the Referer of anything the page then fetches, and a token taken
/// from one would be good for every route the user can reach, not just for
/// this one file.
///
/// The tests below therefore check two things on every link: the ticket is
/// there, and the token is not.
///
/// The ticket is minted over real HTTP against a real server started here on
/// a free port — no stubbing of the client, because what is being checked is
/// precisely the conversation between the two.
class FakeTokenStore extends TokenStore {
  @override
  Future<String?> readAccessToken() async => 'TOKEN.123';
}

/// A real HTTP server that hands out download tickets, and counts what it
/// was asked for.
class TicketServer {
  TicketServer._(this._server) {
    _server.listen(_answer);
  }

  final HttpServer _server;

  /// Every path that was asked for, in order.
  final List<String> paths = <String>[];

  /// How many tickets were minted.
  int issued = 0;

  /// What the next ticket will say. Empty makes the server answer without
  /// one, which is the failure a link has to survive.
  String ticket = 'TICKET.ABC123';

  /// How long the server says a ticket is good for, in seconds.
  int expiresIn = 60;

  static Future<TicketServer> start() async => TicketServer._(
    await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
  );

  String get baseUrl => 'http://127.0.0.1:${_server.port}/api/v1';

  Future<void> _answer(HttpRequest request) async {
    paths.add(request.uri.path);
    final response = request.response;
    response.headers.contentType = ContentType.json;
    if (request.uri.path.endsWith('/auth/download-ticket')) {
      issued += 1;
      response.statusCode = HttpStatus.ok;
      response.write(jsonEncode({'ticket': ticket, 'expiresIn': expiresIn}));
    } else {
      response.statusCode = HttpStatus.notFound;
      response.write(jsonEncode({'message': 'No such route on this server.'}));
    }
    await response.close();
  }

  Future<void> close() async {
    await _server.close(force: true);
  }
}

void main() {
  group('ReportLinkBuilder', () {
    late ProviderContainer container;
    late TicketServer server;

    setUp(() async {
      server = await TicketServer.start();
      final config = AppConfig.forLocalServer(server.baseUrl);
      container = ProviderContainer(
        overrides: [
          auth.appConfigProvider.overrideWithValue(config),
          auth.tokenStoreProvider.overrideWithValue(FakeTokenStore()),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(server.close);
    });

    data.ReportLinkBuilder links() => container.read(data.reportLinkProvider);

    test('auth and data share the exact same appConfigProvider instance', () {
      expect(identical(auth.appConfigProvider, data.appConfigProvider), isTrue);
    });

    test('a report file link carries the ticket and the chosen format', () async {
      final request = await links().file(
        report: 'trial-balance',
        format: 'xlsx',
        language: 'ar',
        from: '2026-01-01',
        to: '2026-12-31',
      );

      expect(request.url, contains('/api/v1/exports/trial-balance/download?'));
      expect(request.url, contains('ticket=TICKET.ABC123'));
      expect(request.url, contains('format=xlsx'));
      expect(request.url, contains('lang=ar'));
      expect(request.url, contains('from=2026-01-01'));
      expect(request.url, contains('to=2026-12-31'));
      expect(server.paths, contains('/api/v1/auth/download-ticket'));
    });

    test('the sign-in token is never put into an address', () async {
      final request = await links().file(
        report: 'trial-balance',
        format: 'xlsx',
        language: 'ar',
      );

      // A browser navigation cannot carry a header, so the temptation is to
      // put the credential in the address. It must not be there.
      expect(request.url, isNot(contains('TOKEN.123')));
      expect(request.url, isNot(contains('token=')));
      expect(request.url, contains('ticket='));
    });

    test('filters the caller did not give are left out, never sent empty', () async {
      final request = await links().file(
        report: 'trial-balance',
        format: 'csv',
        language: 'en',
      );

      expect(request.url, isNot(contains('from=')));
      expect(request.url, isNot(contains('to=')));
      expect(request.url, isNot(contains('accountId=')));
      expect(request.url, isNot(contains('branchId=')));
    });

    test('the print link can ask for the print dialogue by itself', () async {
      final auto = await links().print(report: 'trial-balance', language: 'ar');
      expect(auto, contains('/api/v1/exports/trial-balance/print?'));
      expect(auto, contains('auto=1'));
      expect(auto, contains('ticket=TICKET.ABC123'));
      expect(auto, isNot(contains('TOKEN.123')));

      final paper = await links().print(
        report: 'trial-balance',
        language: 'ar',
        auto: false,
      );
      expect(paper, isNot(contains('auto=')));
    });

    test('a report as a PDF file carries the ticket and nothing else secret',
        () async {
      final request = await links().pdf(
        report: 'profit-and-loss',
        language: 'en',
        from: '2026-01-01',
        to: '2026-06-30',
      );

      expect(request.url, contains('/api/v1/exports/profit-and-loss/pdf?'));
      expect(request.url, contains('ticket=TICKET.ABC123'));
      expect(request.url, contains('from=2026-01-01'));
      expect(request.url, isNot(contains('TOKEN.123')));
    });

    test('list links name the list and carry the screen’s filters', () async {
      final request = await links().listFile(
        list: 'customers',
        format: 'xlsx',
        language: 'ar',
        filters: const {'q': 'acme', 'status': 'active'},
      );

      expect(request.url, contains('/api/v1/exports/lists/customers/download?'));
      expect(request.url, contains('q=acme'));
      expect(request.url, contains('status=active'));
      expect(request.url, contains('ticket=TICKET.ABC123'));
      expect(request.url, isNot(contains('TOKEN.123')));
    });

    test('a list can be asked for as a PDF, or as a page to print', () async {
      final pdf = await links().listPdf(
        list: 'items',
        language: 'ar',
        filters: const {'q': 'coffee'},
      );
      expect(pdf.url, contains('/api/v1/exports/lists/items/pdf?'));
      expect(pdf.url, contains('q=coffee'));
      expect(pdf.url, contains('ticket=TICKET.ABC123'));

      final printed = await links().listPrint(
        list: 'items',
        language: 'ar',
        filters: const {'q': 'coffee'},
      );
      expect(printed, contains('/api/v1/exports/lists/items/print?'));
      expect(printed, contains('auto=1'));
      expect(printed, contains('q=coffee'));
    });

    test('backup links point at the right routes and authenticate', () async {
      final company = await links().backup();
      expect(company.url, contains('/api/v1/backup/download?'));
      expect(company.url, contains('ticket=TICKET.ABC123'));
      expect(company.url, isNot(contains('TOKEN.123')));

      final full = await links().fullBackupDownload('kayan-full-2026.dump');
      expect(
        full.url,
        contains('/api/v1/backup/full/kayan-full-2026.dump/download?'),
      );
      expect(full.url, contains('ticket=TICKET.ABC123'));
    });

    test('a file name is made safe for an address before it is used', () async {
      final full = await links().fullBackupDownload('kayan full 2026.dump');

      // A space would end the URL and the server would be asked for a file
      // called "kayan".
      expect(full.url, isNot(contains('kayan full')));
      expect(full.url, contains('kayan%20full%202026.dump'));
    });

    test('the import template link names the kind being imported', () async {
      final request = await links().importTemplate(
        kind: 'customers',
        language: 'en',
      );

      expect(request.url, contains('/api/v1/import/templates/customers?'));
      expect(request.url, contains('lang=en'));
      expect(request.url, contains('ticket=TICKET.ABC123'));
    });

    test('a ticket is reused while it is still good', () async {
      await links().file(report: 'trial-balance', format: 'xlsx', language: 'ar');
      await links().file(report: 'trial-balance', format: 'csv', language: 'ar');
      await links().backup();

      // Several buttons are pressed in a row; the server should be asked
      // once, not once per click.
      expect(server.issued, 1);
    });

    test('a ticket is minted again once the old one is nearly spent', () async {
      server.expiresIn = 5;

      await links().backup();
      await links().backup();

      expect(server.issued, 2);
    });

    test('a server that hands back no ticket produces no link at all', () async {
      server.ticket = '';

      // Better to fail loudly here than to hand the browser an address that
      // can only come back as a 401.
      expect(links().backup(), throwsA(isA<StateError>()));
    });
  });
}
