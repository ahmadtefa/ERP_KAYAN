/// KAYAN licence key generator for Android.
///
/// The operator's tool, on a phone: the same four key types, the same register
/// and the same files as `KAYAN-Key-Generator.exe`, produced by the same rules
/// (see `lib/src/generator.dart`, which mirrors the Windows tool line by line).
///
/// It is not shipped with the product and contains no signing key of its own:
/// the operator brings the private key, and it stays in this app's private
/// storage.
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'src/bundle.dart';
import 'src/generator.dart';
import 'src/keys.dart';
import 'src/register.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final support = await getApplicationSupportDirectory();
  final folder = KeyFolder(p.join(support.path, 'keyring'));
  final state = OperatorState(folder);
  await state.refresh();
  runApp(KayanKeyGeneratorApp(state: state));
}

/// The app's one piece of shared state: the key folder and its contents.
class OperatorState extends ChangeNotifier {
  OperatorState(this.folder) : generator = LicenceGenerator(folder);

  final KeyFolder folder;
  final LicenceGenerator generator;

  FolderSnapshot? snapshot;
  String? error;
  bool busy = false;

  bool get hasKey => snapshot?.hasKey ?? false;

  Future<void> refresh() async {
    try {
      snapshot = await generator.snapshot();
      error = snapshot?.hasKey == false && folder.hasPrivateKey
          ? 'The key folder cannot be read. Check that the pair belongs together.'
          : null;
    } on Refusal catch (refusal) {
      error = refusal.message;
    } catch (failure) {
      error = '$failure';
    }
    notifyListeners();
  }

  /// Runs one operator action, reporting a refusal as a readable message.
  Future<T?> attempt<T>(Future<T> Function() action) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      return await action();
    } on Refusal catch (refusal) {
      error = refusal.message;
      return null;
    } on FormatException catch (failure) {
      error = failure.message;
      return null;
    } catch (failure) {
      error = 'Unexpected failure: $failure';
      return null;
    } finally {
      busy = false;
      await refresh();
      notifyListeners();
    }
  }
}

class KayanKeyGeneratorApp extends StatelessWidget {
  const KayanKeyGeneratorApp({super.key, required this.state});

  final OperatorState state;

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF0E7C66));
    return MaterialApp(
      title: 'KAYAN key generator',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        fontFamily: 'Roboto',
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
          isDense: true,
        ),
      ),
      builder: (context, child) =>
          Directionality(textDirection: TextDirection.rtl, child: child!),
      home: HomeScreen(state: state),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.state});

  final OperatorState state;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final snapshot = state.snapshot;
        return DefaultTabController(
          length: 4,
          child: Scaffold(
            appBar: AppBar(
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('مولّد مفاتيح كيان', style: TextStyle(fontSize: 18)),
                  Text(
                    snapshot == null
                        ? 'KAYAN key generator'
                        : 'KAYAN key generator · ${snapshot.version} · ${snapshot.fingerprint ?? 'no key'}',
                    style: const TextStyle(fontSize: 11, letterSpacing: 0.2),
                  ),
                ],
              ),
              actions: [
                if (state.busy)
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  ),
                IconButton(
                  tooltip: 'تحديث — refresh',
                  onPressed: state.busy ? null : state.refresh,
                  icon: const Icon(Icons.refresh),
                ),
              ],
              bottom: const TabBar(
                isScrollable: true,
                tabs: [
                  Tab(text: 'إصدار', icon: Icon(Icons.vpn_key_outlined)),
                  Tab(text: 'السجل', icon: Icon(Icons.list_alt)),
                  Tab(text: 'فحص', icon: Icon(Icons.fact_check_outlined)),
                  Tab(text: 'المفتاح', icon: Icon(Icons.shield_outlined)),
                ],
              ),
            ),
            body: TabBarView(
              children: [
                IssueTab(state: state),
                RegisterTab(state: state),
                InspectTab(state: state),
                KeyTab(state: state),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Small bilingual section heading used on every tab.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.subtitle, required this.child});

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: Theme.of(context).colorScheme.outline),
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

void showMessage(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: error ? Theme.of(context).colorScheme.error : null,
      duration: Duration(seconds: error ? 8 : 4),
    ),
  );
}

class IssueTab extends StatefulWidget {
  const IssueTab({super.key, required this.state});

  final OperatorState state;

  @override
  State<IssueTab> createState() => _IssueTabState();
}

class _IssueTabState extends State<IssueTab> {
  static const List<MapEntry<String, String>> _types = [
    MapEntry('ACTIVATION', 'تفعيل — activation'),
    MapEntry('RENEWAL', 'تجديد — renewal'),
    MapEntry('SEATS', 'مقاعد — seats'),
    MapEntry('TRANSFER', 'نقل — transfer'),
  ];

  static const List<MapEntry<String, String>> _terms = [
    MapEntry('', 'كما في الترخيص — as the licence'),
    MapEntry('1m', 'شهر — 1 month'),
    MapEntry('3m', '3 أشهر — 3 months'),
    MapEntry('6m', '6 أشهر — 6 months'),
    MapEntry('1y', 'سنة — 1 year'),
    MapEntry('2y', 'سنتان — 2 years'),
    MapEntry('3y', '3 سنوات — 3 years'),
    MapEntry('P', 'دائم — perpetual'),
  ];

  final _request = TextEditingController();
  final _machine = TextEditingController();
  final _seats = TextEditingController();
  final _increase = TextEditingController(text: '1');
  final _cap = TextEditingController();
  final _used = TextEditingController();
  final _note = TextEditingController();

  String _type = 'ACTIVATION';
  String? _licenceId;
  String _term = '';
  bool _seatModeIncrease = true;

  // Built once: SegmentedButton keeps state against these widgets, and
  // handing it fresh instances on every frame makes it re-schedule frames.
  late final List<ButtonSegment<String>> _typeSegments = [
    for (final type in _types)
      ButtonSegment(
        value: type.key,
        label: Text(type.key, style: const TextStyle(fontSize: 11)),
      ),
  ];

  IssueResult? _result;
  Map<String, dynamic>? _preview;

  @override
  void dispose() {
    for (final controller in [_request, _machine, _seats, _increase, _cap, _used, _note]) {
      controller.dispose();
    }
    super.dispose();
  }

  List<Licence> get _licences => widget.state.snapshot?.licences ?? const [];

  Future<void> _readRequest() async {
    try {
      final request = parseRequestCode(_request.text);
      _machine.text = request.machineId;
      showMessage(context, 'الجهاز: ${request.machineId}');
      setState(() {});
    } on Refusal catch (refusal) {
      showMessage(context, refusal.message, error: true);
    }
  }

  Future<void> _issue({required bool dryRun}) async {
    final licenceId = _licenceId ?? (_licences.isEmpty ? null : _licences.first.licenseId);
    if (licenceId == null) {
      showMessage(context, 'سجّل ترخيصًا أولًا. / Register a licence first.', error: true);
      return;
    }
    final result = await widget.state.attempt(() => widget.state.generator.issueKey(
          type: _type,
          licenceId: licenceId,
          machineId: _machine.text,
          request: _request.text,
          term: _term,
          seats: _type == 'ACTIVATION' ? _seats.text : null,
          increase: _type == 'SEATS' && _seatModeIncrease ? _increase.text : null,
          cap: _type == 'SEATS' && !_seatModeIncrease ? _cap.text : null,
          used: _type == 'TRANSFER' ? _used.text : null,
          note: _note.text,
          dryRun: dryRun,
        ));
    if (!mounted) return;
    if (result == null) {
      if (widget.state.error != null) {
        showMessage(context, widget.state.error!, error: true);
      }
      return;
    }
    setState(() {
      _result = dryRun ? null : result;
      _preview = result.preview;
    });
  }

  @override
  Widget build(BuildContext context) {
    final licences = _licences;
    if (!widget.state.hasKey) {
      return const _NoKeyYet();
    }
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        SectionCard(
          title: 'إصدار مفتاح / Issue a key',
          subtitle: 'نفس الأنواع الأربعة ونفس القواعد التي يطبّقها المولّد على ويندوز.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SegmentedButton<String>(
                segments: _typeSegments,
                selected: {_type},
                showSelectedIcon: false,
                onSelectionChanged: (selection) => setState(() {
                  _type = selection.first;
                  _result = null;
                  _preview = null;
                }),
              ),
              const SizedBox(height: 6),
              Text(
                _types.firstWhere((entry) => entry.key == _type).value,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 14),
              if (licences.isEmpty)
                Text(
                  'لا يوجد ترخيص في السجل. أنشئ ترخيصًا من تبويب «السجل».',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                )
              else
                DropdownButton<String>(
                  isExpanded: true,
                  value: licences.any((l) => l.licenseId == _licenceId) ? _licenceId : licences.first.licenseId,
                  items: [
                    for (final licence in licences)
                      DropdownMenuItem(
                        value: licence.licenseId,
                        child: Text(
                          '${licence.ref ?? licence.licenseId}  ·  ${licence.seats} مقعد  ·  ${licence.status}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => _licenceId = value),
                ),
              const SizedBox(height: 12),
              if (_type == 'ACTIVATION' || _type == 'TRANSFER') ...[
                TextField(
                  controller: _request,
                  minLines: 2,
                  maxLines: 4,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(
                    labelText: 'كود الطلب من شاشة العميل — request code (KYNREQ1.…)',
                    hintText: 'KYNREQ1.…',
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: _readRequest,
                    icon: const Icon(Icons.input, size: 18),
                    label: const Text('قراءة الكود — read request'),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _machine,
                  textDirection: TextDirection.ltr,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'معرّف الجهاز — machine id',
                    hintText: 'KM-XXXX-XXXX-XXXX-XXXX',
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_type == 'ACTIVATION' || _type == 'RENEWAL')
                DropdownButton<String>(
                  isExpanded: true,
                  value: _term,
                  items: [
                    for (final entry in _terms)
                      DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                  ],
                  onChanged: (value) => setState(() => _term = value ?? ''),
                ),
              if (_type == 'ACTIVATION') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _seats,
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(
                    labelText: 'حد المستخدمين — seat limit (اتركه فارغًا لاستخدام حد الترخيص)',
                  ),
                ),
              ],
              if (_type == 'SEATS') ...[
                const SizedBox(height: 12),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: true, label: Text('زيادة — increase')),
                    ButtonSegment(value: false, label: Text('سقف جديد — new cap')),
                  ],
                  selected: {_seatModeIncrease},
                  showSelectedIcon: false,
                  onSelectionChanged: (selection) => setState(() => _seatModeIncrease = selection.first),
                ),
                const SizedBox(height: 10),
                if (_seatModeIncrease)
                  TextField(
                    controller: _increase,
                    keyboardType: TextInputType.number,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(labelText: 'الزيادة بعدد المقاعد — increase by'),
                  )
                else
                  TextField(
                    controller: _cap,
                    keyboardType: TextInputType.number,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(labelText: 'السقف الجديد — new cap'),
                  ),
              ],
              if (_type == 'TRANSFER') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _used,
                  keyboardType: TextInputType.number,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(
                    labelText: 'المستخدمون الحاليون — seats in use (من شاشة العميل)',
                  ),
                ),
              ],
              const SizedBox(height: 12),
              TextField(
                controller: _note,
                decoration: const InputDecoration(
                  labelText: 'ملاحظة إدارية (تُكتب داخل المفتاح) — note',
                  hintText: 'INV-2026-001',
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: widget.state.busy ? null : () => _issue(dryRun: true),
                      icon: const Icon(Icons.visibility_outlined, size: 18),
                      label: const Text('معاينة — preview'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: widget.state.busy ? null : () => _issue(dryRun: false),
                      icon: const Icon(Icons.key, size: 18),
                      label: const Text('إصدار — issue'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (_preview != null) _PreviewCard(preview: _preview!),
        if (_result != null) _KeyCard(result: _result!),
      ],
    );
  }
}

class _NoKeyYet extends StatelessWidget {
  const _NoKeyYet();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.key_off_outlined, size: 44, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            const Text(
              'لا يوجد مفتاح توقيع في هذا الجهاز.\nافتح تبويب «المفتاح» واستورد مفتاح المشغّل.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            const Text(
              'No signing key here. Open the “key” tab and import the operator key.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.preview});

  final Map<String, dynamic> preview;

  @override
  Widget build(BuildContext context) {
    final rows = <String, Object?>{
      'type': preview['type'],
      'licence': preview['licenseId'],
      'key id': preview['keyId'],
      'machine': preview['machineId'] ?? '—',
      'term': preview['term'] == null ? '—' : jsonEncode(preview['term']),
      'seats': preview['seats'] == null ? '—' : jsonEncode(preview['seats']),
      'issued': preview['issuedAt'],
    };
    return SectionCard(
      title: 'معاينة — preview',
      subtitle: 'لم يُوقَّع شيء بعد. / Nothing has been signed.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in rows.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('${entry.key}: ${entry.value}', style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
            ),
        ],
      ),
    );
  }
}

class _KeyCard extends StatelessWidget {
  const _KeyCard({required this.result});

  final IssueResult result;

  @override
  Widget build(BuildContext context) {
    final key = result.key ?? '';
    return SectionCard(
      title: 'المفتاح الموقّع — signed key',
      subtitle: 'أرسل السطر كاملًا. لا يُقسَّم. / Send the whole line; never split it.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              key,
              textDirection: TextDirection.ltr,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11, height: 1.4),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: key));
                    if (context.mounted) showMessage(context, 'تم النسخ — copied');
                  },
                  icon: const Icon(Icons.copy, size: 18),
                  label: const Text('نسخ — copy'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            '${result.preview['type']} · ${result.preview['machineId'] ?? '—'} · '
            '${result.preview['term'] == null ? 'perpetual' : jsonEncode(result.preview['term'])}',
            style: const TextStyle(fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class RegisterTab extends StatefulWidget {
  const RegisterTab({super.key, required this.state});

  final OperatorState state;

  @override
  State<RegisterTab> createState() => _RegisterTabState();
}

class _RegisterTabState extends State<RegisterTab> {
  final _ref = TextEditingController();
  final _seats = TextEditingController(text: '5');
  String _term = '1y';

  @override
  void dispose() {
    _ref.dispose();
    _seats.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final result = await widget.state.attempt(
      () => widget.state.generator.createLicence(
        ref: _ref.text,
        seats: _seats.text,
        term: _term,
      ),
    );
    if (!mounted) return;
    if (result == null) {
      if (widget.state.error != null) showMessage(context, widget.state.error!, error: true);
      return;
    }
    _ref.clear();
    showMessage(context, 'تم تسجيل الترخيص ${result.licence.licenseId}');
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = widget.state.snapshot;
    if (!widget.state.hasKey) return const _NoKeyYet();
    final licences = snapshot?.licences ?? const <Licence>[];
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        SectionCard(
          title: 'تسجيل ترخيص / Register a licence',
          subtitle: 'ما اشتراه العميل: الحد والمدة. كل مفتاح يُقاس على هذا السجل.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _ref,
                decoration: const InputDecoration(labelText: 'العميل — customer'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _seats,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(labelText: 'حد المستخدمين — seat limit'),
              ),
              const SizedBox(height: 10),
              DropdownButton<String>(
                isExpanded: true,
                value: _term,
                items: const [
                  DropdownMenuItem(value: '1m', child: Text('شهر — 1 month')),
                  DropdownMenuItem(value: '6m', child: Text('6 أشهر — 6 months')),
                  DropdownMenuItem(value: '1y', child: Text('سنة — 1 year')),
                  DropdownMenuItem(value: '2y', child: Text('سنتان — 2 years')),
                  DropdownMenuItem(value: '3y', child: Text('3 سنوات — 3 years')),
                  DropdownMenuItem(value: 'P', child: Text('دائم — perpetual')),
                ],
                onChanged: (value) => setState(() => _term = value ?? '1y'),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: widget.state.busy ? null : _create,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('تسجيل — register'),
              ),
            ],
          ),
        ),
        if (licences.isEmpty)
          const Padding(padding: EdgeInsets.all(16), child: Text('السجل فارغ. / The register is empty.'))
        else
          for (final licence in licences) _LicenceCard(state: widget.state, licence: licence),
        SectionCard(
          title: 'آخر العمليات — recent audit',
          subtitle: 'الوقت والعملية ومعرّفاتها. لا يُسجَّل المفتاح الخاص ولا نص المفتاح ولا الملاحظات.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final entry in snapshot?.audit ?? const <Map<String, dynamic>>[])
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    '${entry['at']}  ${entry['action']}  ${entry['keyId'] ?? entry['licenseId'] ?? ''}  ${entry['result'] ?? ''}',
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LicenceCard extends StatelessWidget {
  const _LicenceCard({required this.state, required this.licence});

  final OperatorState state;
  final Licence licence;

  @override
  Widget build(BuildContext context) {
    final keys = (state.snapshot?.keys ?? const <IssuedKey>[])
        .where((key) => key.licenseId == licence.licenseId)
        .toList();
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        title: Text(licence.ref ?? licence.licenseId, style: const TextStyle(fontSize: 15)),
        subtitle: Text(
          '${licence.seats} مقعد · مستخدم ${licence.seatsUsed} · '
          '${licence.term == null ? 'دائم' : '${licence.term} شهر'} · '
          '${licence.expiresAt?.substring(0, 10) ?? 'بلا انتهاء'}',
          style: const TextStyle(fontSize: 11.5),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(licence.licenseId, style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
          const SizedBox(height: 4),
          Text('machine: ${licence.machineId ?? '—'}', style: const TextStyle(fontSize: 11)),
          const SizedBox(height: 8),
          for (final key in keys)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${key.type.padRight(10)} ${key.machineId ?? '—'}  ${key.issuedAt.substring(0, 10)}  ${key.keyId}',
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5),
                    ),
                  ),
                  Chip(
                    visualDensity: VisualDensity.compact,
                    label: Text(key.status, style: const TextStyle(fontSize: 10)),
                  ),
                  if (key.status == 'issued')
                    IconButton(
                      tooltip: 'سُجِّل استخدامه — mark used',
                      icon: const Icon(Icons.check_circle_outline, size: 18),
                      onPressed: () async {
                        await state.attempt(() => state.generator.markUsed(key.keyId));
                      },
                    ),
                  if (key.status != 'revoked')
                    IconButton(
                      tooltip: 'إلغاء — revoke',
                      icon: const Icon(Icons.block, size: 18),
                      onPressed: () async {
                        final reason = await _askReason(context);
                        if (reason == null || reason.isEmpty) return;
                        await state.attempt(() => state.generator.revoke(key.keyId, reason));
                      },
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<String?> _askReason(BuildContext context) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('سبب الإلغاء — reason'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'wrong machine sent'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('تراجع — cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('إلغاء المفتاح — revoke'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }
}

class InspectTab extends StatefulWidget {
  const InspectTab({super.key, required this.state});

  final OperatorState state;

  @override
  State<InspectTab> createState() => _InspectTabState();
}

class _InspectTabState extends State<InspectTab> {
  final _key = TextEditingController();
  Map<String, dynamic>? _payload;
  bool? _valid;

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.state.hasKey) return const _NoKeyYet();
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        SectionCard(
          title: 'فحص مفتاح / Inspect a signed key',
          subtitle: 'يتحقق بمفتاح هذا الجهاز — نفس المفتاح العام المثبَّت في البرنامج.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _key,
                minLines: 3,
                maxLines: 6,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(hintText: 'KYN1.…'),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: widget.state.busy
                    ? null
                    : () async {
                        final result = await widget.state.attempt(
                          () => widget.state.generator.verifyKey(_key.text),
                        );
                        if (result == null) {
                          setState(() {
                            _payload = null;
                            _valid = false;
                          });
                          if (widget.state.error != null && context.mounted) {
                            showMessage(context, widget.state.error!, error: true);
                          }
                          return;
                        }
                        setState(() {
                          _payload = result.payload;
                          _valid = result.valid;
                        });
                      },
                icon: const Icon(Icons.verified_outlined, size: 18),
                label: const Text('فحص — verify'),
              ),
            ],
          ),
        ),
        if (_valid != null)
          SectionCard(
            title: _valid! ? 'التوقيع صحيح — signature valid' : 'التوقيع غير صحيح — signature INVALID',
            subtitle: 'المفتاح مقروء، لكن التحقق هو الفيصل.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final entry in (_payload ?? const <String, dynamic>{'payload': 'unreadable'}).entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '${entry.key}: ${entry.value}',
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class KeyTab extends StatefulWidget {
  const KeyTab({super.key, required this.state});

  final OperatorState state;

  @override
  State<KeyTab> createState() => _KeyTabState();
}

class _KeyTabState extends State<KeyTab> {
  final _import = TextEditingController();
  final _confirm = TextEditingController();

  @override
  void dispose() {
    _import.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _importPem() async {
    final text = _import.text.trim();
    if (text.isEmpty) {
      showMessage(context, 'الصق محتوى private-key.pem أولًا.', error: true);
      return;
    }
    if (!looksLikePem(text, 'PRIVATE KEY')) {
      showMessage(context, 'هذا ليس ملف مفتاح خاص بصيغة PEM.', error: true);
      return;
    }
    final key = await widget.state.attempt(() async {
      final signing = await SigningKey.fromPem(text);
      return signing;
    });
    if (!mounted) return;
    if (key == null) {
      if (widget.state.error != null) showMessage(context, widget.state.error!, error: true);
      return;
    }
    final bundle = await widget.state.attempt(() async {
      // The private key alone is not a folder: the public key is derived from
      // it, and the register stays as it is (empty on a fresh phone).
      await widget.state.folder.ensure();
      await widget.state.folder.writeKeyPair(key);
      return true;
    });
    if (!mounted) return;
    if (bundle == null) {
      if (widget.state.error != null) showMessage(context, widget.state.error!, error: true);
      return;
    }
    _import.clear();
    await widget.state.refresh();
    if (mounted) showMessage(context, 'تم استيراد مفتاح التوقيع — signing key imported');
  }

  Future<void> _createPair() async {
    if (_confirm.text.trim().toUpperCase() != 'CREATE') {
      showMessage(context, 'اكتب CREATE في الحقل للتأكيد.', error: true);
      return;
    }
    final result = await widget.state.attempt(() => widget.state.folder.createKeyPair());
    _confirm.clear();
    if (result != null && mounted) {
      showMessage(context, 'تم إنشاء زوج مفاتيح جديد. انسخ المفتاح العام إلى البرنامج.');
    } else if (widget.state.error != null && mounted) {
      showMessage(context, widget.state.error!, error: true);
    }
  }

  Future<void> _copyPublicKey() async {
    final key = await widget.state.attempt(() async {
      final signing = await widget.state.folder.readSigningKey();
      return signing.publicKeyBase64Url();
    });
    if (key == null) return;
    await Clipboard.setData(ClipboardData(text: key));
    if (mounted) showMessage(context, 'تم نسخ المفتاح العام — LICENSE_PUBLIC_KEY copied');
  }

  Future<void> _export({required bool withPrivateKey}) async {
    final bundle = await widget.state.attempt(() async {
      if (withPrivateKey && _confirm.text.trim().toUpperCase() != 'EXPORT') {
        throw Refusal('To include the private key in a bundle, type EXPORT in the box first.');
      }
      return exportBundle(widget.state.folder, includePrivateKey: withPrivateKey);
    });
    if (bundle == null) {
      if (widget.state.error != null && mounted) {
        showMessage(context, widget.state.error!, error: true);
      }
      return;
    }
    await Clipboard.setData(ClipboardData(text: bundle));
    if (mounted) {
      showMessage(
        context,
        withPrivateKey
            ? 'نُسخ مجلد المفاتيح كاملًا — بما فيه المفتاح الخاص. تعامل معه كسرّ.'
            : 'نُسخ السجل بلا مفتاح خاص.',
      );
    }
  }

  Future<void> _importBundle() async {
    final done = await widget.state.attempt(() async {
      await importBundle(widget.state.folder, _import.text);
      return true;
    });
    if (done == true && mounted) {
      _import.clear();
      showMessage(context, 'تم استيراد المجلد — folder imported');
    } else if (widget.state.error != null && mounted) {
      showMessage(context, widget.state.error!, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = widget.state.snapshot;
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        SectionCard(
          title: 'المفتاح — signing key',
          subtitle: snapshot?.hasKey == true
              ? 'البصمة: ${snapshot!.fingerprint}'
              : 'لا يوجد مفتاح بعد — استورد مفتاح المشغّل أو أنشئ زوجًا جديدًا.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (snapshot?.hasKey == true) ...[
                FilledButton.icon(
                  onPressed: _copyPublicKey,
                  icon: const Icon(Icons.copy_all, size: 18),
                  label: const Text('نسخ المفتاح العام — copy LICENSE_PUBLIC_KEY'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => _export(withPrivateKey: false),
                  icon: const Icon(Icons.ios_share, size: 18),
                  label: const Text('تصدير السجل — export register (no private key)'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => _export(withPrivateKey: true),
                  icon: const Icon(Icons.warning_amber_outlined, size: 18),
                  label: const Text('تصدير المجلد كاملًا — export whole folder'),
                ),
              ],
              const SizedBox(height: 6),
              Text(
                'المجلد: ${snapshot?.home ?? widget.state.folder.home}',
                textDirection: TextDirection.ltr,
                style: const TextStyle(fontSize: 10.5, fontFamily: 'monospace'),
              ),
            ],
          ),
        ),
        SectionCard(
          title: 'استيراد / Import',
          subtitle: 'الصق محتوى private-key.pem، أو حزمة صدّرها المولّد (JSON).',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _import,
                minLines: 4,
                maxLines: 8,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(hintText: '-----BEGIN PRIVATE KEY----- …'),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: widget.state.busy ? null : _importPem,
                icon: const Icon(Icons.key, size: 18),
                label: const Text('استيراد مفتاح خاص — import private key'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: widget.state.busy ? null : _importBundle,
                icon: const Icon(Icons.inventory_2_outlined, size: 18),
                label: const Text('استيراد حزمة مجلد — import a folder bundle'),
              ),
            ],
          ),
        ),
        SectionCard(
          title: 'زوج مفاتيح جديد / A new key pair',
          subtitle: 'فقط عند أول تنصيب. استبدال زوج قائم يجعل كل مفتاح سابق غير مقبول في البرنامج.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _confirm,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(
                  labelText: 'اكتب CREATE (أو EXPORT قبل تصدير المفتاح الخاص)',
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: widget.state.busy ? null : _createPair,
                icon: const Icon(Icons.auto_fix_high, size: 18),
                label: const Text('إنشاء زوج مفاتيح — create key pair'),
              ),
            ],
          ),
        ),
        SectionCard(
          title: 'عن الأداة / About',
          subtitle: 'KAYAN key generator $toolVersion',
          child: const Text(
            'هذه هي أداة المورّد نفسها: نفس صيغة المفتاح، ونفس المدة والمقاعد، وملفات '
            'مجلد المفاتيح مطابقة لما يكتبه المولّد على ويندوز، فالحزمة تنتقل بين الجهازين. '
            'لا تُشحن هذه الأداة مع البرنامج، ولا تحمل مفتاح إنتاج داخلها.',
            style: TextStyle(fontSize: 12, height: 1.6),
          ),
        ),
      ],
    );
  }
}
