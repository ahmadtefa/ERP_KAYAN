import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/app_error_text.dart';
import '../../../../core/error/failure.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Talks to the scheduled-backup routes (settings, status, history, run now).
class AutoBackupService {
  AutoBackupService(this._dio);

  final Dio _dio;

  Future<Map<String, dynamic>> settings() async {
    final response = await _dio.get<Map<String, dynamic>>('/backup/schedule/settings');
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<Map<String, dynamic>> status() async {
    final response = await _dio.get<Map<String, dynamic>>('/backup/schedule');
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<List<Map<String, dynamic>>> history() async {
    final response = await _dio.get<List<dynamic>>('/backup/schedule/history', queryParameters: {'take': 10});
    return [for (final row in response.data ?? const []) Map<String, dynamic>.from(row as Map)];
  }

  Future<Map<String, dynamic>> checkFolder(String path) async {
    final response = await _dio.post<Map<String, dynamic>>('/backup/schedule/check-folder', data: {'path': path});
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<Map<String, dynamic>> save(Map<String, dynamic> body) async {
    final response = await _dio.post<Map<String, dynamic>>('/backup/schedule/settings', data: body);
    return Map<String, dynamic>.from(response.data ?? const {});
  }

  Future<List<dynamic>> runNow() async {
    final response = await _dio.post<List<dynamic>>(
      '/backup/schedule/run',
      data: const <String, dynamic>{},
      options: Options(receiveTimeout: const Duration(minutes: 30)),
    );
    return response.data ?? const [];
  }
}

final autoBackupServiceProvider = Provider<AutoBackupService>(
  (ref) => AutoBackupService(ref.read(apiClientProvider).raw),
);

const _presets = <int, List<String>>{
  0: ['متوقف', 'Off'],
  1: ['كل ساعة', 'Every hour'],
  6: ['كل 6 ساعات', 'Every 6 hours'],
  24: ['يوميًا', 'Daily'],
  168: ['أسبوعيًا', 'Weekly'],
  -1: ['عدد ساعات آخر', 'Other number of hours'],
};

/// Automatic backups: on/off, how often, where the copy goes, how many copies
/// are kept, the last result and "back up now". A failed run shows a red
/// banner; nothing here ever hides a failure.
class AutoBackupSection extends ConsumerStatefulWidget {
  const AutoBackupSection({super.key});

  @override
  ConsumerState<AutoBackupSection> createState() => _AutoBackupSectionState();
}

class _AutoBackupSectionState extends ConsumerState<AutoBackupSection> {
  final _folder = TextEditingController();
  final _hours = TextEditingController();
  final _keep = TextEditingController();
  int _preset = 168;
  int _startHour = 2;
  Map<String, dynamic>? _status;
  List<Map<String, dynamic>> _history = const [];
  bool _loading = true;
  bool _busy = false;
  String? _loadFailure;
  String? _notice;
  String? _failure;

  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _folder.dispose();
    _hours.dispose();
    _keep.dispose();
    super.dispose();
  }

  String _describe(Object error) {
    final status = error is DioException ? error.response?.statusCode : null;
    Object raw = error;
    if (error is DioException) {
      final data = error.response?.data;
      if (data is Map) {
        raw = ApiFailure(
          '${data['message'] ?? ''}',
          statusCode: status,
          code: data['code'] is String ? data['code'] as String : null,
        );
      }
    }
    final resolved = AppErrorMessageResolver(isArabic: _ar).resolve(raw, statusCode: status);
    return resolved.businessMessage ??
        _t('تعذّر إكمال العملية. تأكد من اتصال الخادم ثم أعد المحاولة.', 'The operation could not be completed. Check the server connection, then try again.');
  }

  Future<void> _load() async {
    final service = ref.read(autoBackupServiceProvider);
    setState(() {
      _loading = true;
      _loadFailure = null;
    });
    try {
      final settings = await service.settings();
      final status = await service.status();
      final history = await service.history();
      if (!mounted) return;
      final interval = (settings['intervalHours'] as num?)?.toInt() ?? 168;
      setState(() {
        _status = status;
        _history = history;
        _preset = _presets.containsKey(interval) ? interval : -1;
        _hours.text = '$interval';
        _keep.text = '${(settings['retentionCount'] as num?)?.toInt() ?? 14}';
        _folder.text = (settings['destinationPath'] as String?) ?? '';
        _startHour = (settings['startHour'] as num?)?.toInt() ?? 2;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadFailure = _describe(error);
      });
    }
  }

  int? get _intervalValue => _preset == -1 ? int.tryParse(_hours.text.trim()) : _preset;

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _notice = null;
      _failure = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _failure = _describe(error));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _check() => _run(() async {
        final result = await ref.read(autoBackupServiceProvider).checkFolder(_folder.text);
        final free = (result['freeBytes'] as num?)?.toDouble();
        final gb = free == null ? null : (free / (1024 * 1024 * 1024)).toStringAsFixed(1);
        final same = result['sameDiskAsProgram'] == true;
        setState(() {
          _notice = [
            _t('المجلد صالح وتمت تجربة الكتابة فيه.', 'The folder is valid and a test write succeeded.'),
            if (gb != null) _t('المساحة الحرة: $gb جيجابايت.', 'Free space: $gb GB.'),
            if (same)
              _t('تنبيه: المجلد على نفس قرص البرنامج، فلن تنجو النسخة إن تلف القرص.',
                  'Warning: the folder is on the same disk as the program, so the copy would not survive a disk failure.'),
          ].join(' ');
        });
      });

  Future<void> _save() => _run(() async {
        final interval = _intervalValue;
        final keep = int.tryParse(_keep.text.trim());
        if (interval == null || interval < 0 || interval > 8760) {
          setState(() => _failure = _t(
              'عدد الساعات غير صحيح. اكتب رقمًا من 0 إلى 8760، ثم احفظ.',
              'The number of hours is not valid. Enter a number from 0 to 8760, then save.'));
          return;
        }
        if (keep == null || keep < 1 || keep > 3650) {
          setState(() => _failure = _t(
              'عدد النسخ المحفوظة غير صحيح. اكتب رقمًا من 1 إلى 3650، ثم احفظ.',
              'The number of copies to keep is not valid. Enter a number from 1 to 3650, then save.'));
          return;
        }
        await ref.read(autoBackupServiceProvider).save({
          'intervalHours': interval,
          'retentionCount': keep,
          'startHour': _startHour,
          'destinationPath': _folder.text.trim().isEmpty ? null : _folder.text.trim(),
        });
        setState(() => _notice = _t('تم حفظ إعدادات النسخ الاحتياطي التلقائي.', 'The automatic backup settings were saved.'));
        await _load();
      });

  Future<void> _backupNow() => _run(() async {
        final result = await ref.read(autoBackupServiceProvider).runNow();
        final first = result.isNotEmpty ? Map<String, dynamic>.from(result.first as Map) : const <String, dynamic>{};
        setState(() => _notice = first['status'] == 'SUCCESS'
            ? _t('تمت النسخة الاحتياطية وتم التحقق منها.', 'The backup was created and verified.')
            : null);
        if (first['status'] != 'SUCCESS') {
          setState(() => _failure = _t('لم تنجح النسخة الاحتياطية. راجع آخر نتيجة أدناه، ثم أعد المحاولة.',
              'The backup did not succeed. See the last result below, then try again.'));
        }
        await _load();
      });

  String _statusLabel(String? status) => switch (status) {
        'SUCCESS' || 'VERIFIED' => _t('نجحت', 'Succeeded'),
        'FAILED' => _t('فشلت', 'Failed'),
        _ => status ?? '-',
      };

  String _when(String? iso) {
    final date = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
    if (date == null) return '-';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${date.year}-${two(date.month)}-${two(date.day)} ${two(date.hour)}:${two(date.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final last = _status?['lastRun'] as Map?;
    final failed = last != null && last['status'] == 'FAILED';
    final lastMessage = _history.isNotEmpty ? _history.first['message'] as String? : null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_t('النسخ الاحتياطي التلقائي', 'Automatic backup'), style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(_t(
                'يأخذ البرنامج نسخة كاملة (قاعدة البيانات والملفات وحالة الترخيص) ويفحصها بعد كل مرة. لا تُحذف النسخ القديمة إلا بعد نجاح نسخة جديدة.',
                'The program takes a complete backup (database, files and licence state) and verifies it each time. Older copies are removed only after a new copy succeeds.')),
            const SizedBox(height: 12),
            if (_loading) const LinearProgressIndicator(),
            if (_loadFailure != null) ...[
              Text(_loadFailure!, style: TextStyle(color: theme.colorScheme.error)),
              TextButton(onPressed: _load, child: Text(_t('إعادة المحاولة', 'Try again'))),
            ],
            if (!_loading && _loadFailure == null) ...[
              if (failed)
                Container(
                  key: const Key('auto-backup-failed-banner'),
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 12),
                  color: theme.colorScheme.errorContainer,
                  child: Text(
                    _t('آخر نسخة احتياطية تلقائية فشلت، والنسخ السابقة محفوظة. ', 'The last automatic backup failed; earlier copies are kept. ') +
                        (lastMessage ?? ''),
                    style: TextStyle(color: theme.colorScheme.onErrorContainer),
                  ),
                ),
              Text(_t('آخر نتيجة: ', 'Last result: ') +
                  (last == null ? _t('لا توجد نسخة بعد', 'no backup yet') : '${_statusLabel(last['status'] as String?)} (${_when(last['createdAt'] as String?)})')),
              Text(_t('الموعد القادم: ', 'Next due: ') +
                  (_status?['enabled'] == true ? _when(_status?['nextDueAt'] as String?) : _t('متوقف', 'off'))),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  DropdownButton<int>(
                    key: const Key('auto-backup-interval'),
                    value: _preset,
                    items: [
                      for (final entry in _presets.entries)
                        DropdownMenuItem(value: entry.key, child: Text(_ar ? entry.value[0] : entry.value[1])),
                    ],
                    onChanged: _busy ? null : (value) => setState(() => _preset = value ?? 168),
                  ),
                  if (_preset == -1)
                    SizedBox(
                      width: 140,
                      child: TextField(
                        key: const Key('auto-backup-hours'),
                        controller: _hours,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(labelText: _t('كل كم ساعة', 'Every how many hours')),
                      ),
                    ),
                  SizedBox(
                    width: 160,
                    child: DropdownButtonFormField<int>(
                      key: const Key('auto-backup-hour'),
                      initialValue: _startHour,
                      decoration: InputDecoration(labelText: _t('تبدأ من الساعة', 'Starts from hour')),
                      items: [for (var h = 0; h < 24; h++) DropdownMenuItem(value: h, child: Text('${h.toString().padLeft(2, '0')}:00'))],
                      onChanged: _busy ? null : (value) => setState(() => _startHour = value ?? 2),
                    ),
                  ),
                  SizedBox(
                    width: 160,
                    child: TextField(
                      key: const Key('auto-backup-keep'),
                      controller: _keep,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(labelText: _t('عدد النسخ المحفوظة', 'Copies to keep')),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('auto-backup-folder'),
                controller: _folder,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: _t('مجلد نسخة إضافية (اختياري)', 'Extra copy folder (optional)'),
                  helperText: _t('مسار كامل مثل D:\\Backups أو مجلد على قرص خارجي. اتركه فارغًا لحفظ النسخة في مجلد البرنامج فقط.',
                      'A full path such as D:\\Backups or a folder on an external disk. Leave empty to keep the copy only in the program folder.'),
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(onPressed: _busy ? null : _save, child: Text(_t('حفظ الإعدادات', 'Save settings'))),
                  OutlinedButton(
                    onPressed: _busy || _folder.text.trim().isEmpty ? null : _check,
                    child: Text(_t('فحص المجلد', 'Check folder')),
                  ),
                  OutlinedButton(onPressed: _busy ? null : _backupNow, child: Text(_t('نسخ احتياطي الآن', 'Back up now'))),
                ],
              ),
              if (_busy) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
              if (_notice != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_notice!)),
              if (_failure != null)
                Padding(padding: const EdgeInsets.only(top: 8), child: Text(_failure!, style: TextStyle(color: theme.colorScheme.error))),
              if (_history.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(_t('آخر العمليات', 'Recent runs'), style: theme.textTheme.titleSmall),
                for (final row in _history.take(5))
                  Text('${_when(row['createdAt'] as String?)}  ${_statusLabel(row['status'] as String?)}  ${row['fileName'] ?? ''}'),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
