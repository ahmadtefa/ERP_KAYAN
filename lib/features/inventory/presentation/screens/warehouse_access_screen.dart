import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Who may enter which shelf.
///
/// Reading a person's warehouse rights is its own grant, and changing them is a
/// narrower one still - this is the control that decides who can post stock
/// into which room. A person with no grants is unrestricted within their
/// branches, which the screen says in words: an empty table would otherwise
/// read as "this person can see nothing", the opposite of what it means.
final _peopleProvider = FutureProvider<List<Json>>((ref) async {
  return ref
      .read(apiClientProvider)
      .getList('/admin/users', query: const {'pageSize': 200, 'page': 1});
});

/// The person whose rights are being edited.
class _Subject extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? id) => state = id;
}

final _subjectProvider = NotifierProvider<_Subject, String?>(_Subject.new);

final _accessProvider = FutureProvider.family<Json, String>((ref, userId) async {
  return ref.read(apiClientProvider).get('/inventory/warehouse-access/$userId');
});

/// The seven rights the backend stores per warehouse.
const _rights = [
  'canView',
  'canReceive',
  'canIssue',
  'canTransfer',
  'canCount',
  'canApprove',
  'canSeeCost',
];

class WarehouseAccessScreen extends ConsumerWidget {
  const WarehouseAccessScreen({super.key});

  bool _arabic(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final arabic = _arabic(context);
    final mayRead =
        ref.watch(currentUserProvider)?.can('inventory.warehouse.access.read') ??
        false;
    final mayManage =
        ref
            .watch(currentUserProvider)
            ?.can('inventory.warehouse.access.manage') ??
        false;
    // The user list is behind admin.users.manage, so a warehouse supervisor
    // without it is told why the picker is empty rather than shown a blank one.
    final mayListUsers =
        ref.watch(currentUserProvider)?.can('admin.users.manage') ?? false;

    if (!mayRead) {
      return ModuleScaffold(
        title: arabic ? 'صلاحيات المستودعات' : 'Warehouse access',
        eyebrow: arabic ? 'المخزون' : 'Inventory',
        body: Center(
          child: Text(
            arabic
                ? 'تحتاج صلاحية عرض صلاحيات المستودعات.'
                : 'You need the warehouse-access read grant.',
          ),
        ),
      );
    }

    if (!mayListUsers) {
      return ModuleScaffold(
        title: arabic ? 'صلاحيات المستودعات' : 'Warehouse access',
        eyebrow: arabic ? 'المخزون' : 'Inventory',
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              arabic
                  ? 'قائمة المستخدمين تحتاج صلاحية إدارة المستخدمين (admin.users.manage).'
                  : 'Listing the company\'s people needs admin.users.manage. '
                        'Ask an administrator to grant it, or open the person '
                        'from the user administration screen.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }

    final people = ref.watch(_peopleProvider);
    return ModuleScaffold(
      title: arabic ? 'صلاحيات المستودعات' : 'Warehouse access',
      eyebrow: arabic ? 'المخزون' : 'Inventory',
      body: AsyncStateView<List<Json>>(
        value: people,
        onRetry: () => ref.invalidate(_peopleProvider),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: arabic ? 'لا يوجد مستخدمون.' : 'No users.',
        data: (rows) {
          final subject = ref.watch(_subjectProvider);
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 280,
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final person in rows)
                      ListTile(
                        dense: true,
                        selected: text(person, 'id') == subject,
                        title: Text(
                          arabic
                              ? text(person, 'fullNameAr')
                              : text(person, 'fullNameEn'),
                        ),
                        subtitle: Text(text(person, 'username')),
                        onTap: () => ref
                            .read(_subjectProvider.notifier)
                            .select(text(person, 'id')),
                      ),
                  ],
                ),
              ),
              const VerticalDivider(width: 1),
              Expanded(
                child: subject == null
                    ? Center(
                        child: Text(
                          arabic
                              ? 'اختر مستخدمًا لعرض صلاحياته.'
                              : 'Choose a person to see their rights.',
                        ),
                      )
                    : _rights(context, ref, subject, mayManage),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _rights(
    BuildContext context,
    WidgetRef ref,
    String userId,
    bool mayManage,
  ) {
    return _AccessEditor(
      key: ValueKey(userId),
      userId: userId,
      mayManage: mayManage,
    );
  }
}

/// The editor for one person.
///
/// The endpoint replaces a person's grant set, so a per-chip request would wipe
/// every other warehouse they were granted. The edits are therefore held here
/// as a draft and sent once, complete, when Save is pressed.
class _AccessEditor extends ConsumerStatefulWidget {
  const _AccessEditor({
    super.key,
    required this.userId,
    required this.mayManage,
  });

  final String userId;
  final bool mayManage;

  @override
  ConsumerState<_AccessEditor> createState() => _AccessEditorState();
}

class _AccessEditorState extends ConsumerState<_AccessEditor> {
  /// warehouseId -> the rights on it. Loaded from the server, edited locally.
  Map<String, Map<String, dynamic>>? _draft;
  bool _dirty = false;
  bool _saving = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _right(String key) {
    final arabic = _arabic;
    return switch (key) {
      'canView' => arabic ? 'عرض' : 'View',
      'canReceive' => arabic ? 'استلام' : 'Receive',
      'canIssue' => arabic ? 'صرف' : 'Issue',
      'canTransfer' => arabic ? 'تحويل' : 'Transfer',
      'canCount' => arabic ? 'جرد' : 'Count',
      'canApprove' => arabic ? 'اعتماد' : 'Approve',
      _ => arabic ? 'رؤية التكلفة' : 'See cost',
    };
  }

  Map<String, Map<String, dynamic>> _fromServer(Json data) {
    final grants = (data['grants'] is List) ? (data['grants'] as List) : const [];
    return {
      for (final entry in grants.whereType<Map>())
        text(Map<String, dynamic>.from(entry), 'warehouseId'):
            Map<String, dynamic>.from(entry),
    };
  }

  @override
  Widget build(BuildContext context) {
    final arabic = _arabic;
    final access = ref.watch(_accessProvider(widget.userId));

    return AsyncStateView<Json>(
      value: access,
      onRetry: () => ref.invalidate(_accessProvider(widget.userId)),
      data: (data) {
        // Seed the draft from the server once; after that the draft is what the
        // person is looking at and editing.
        _draft ??= _fromServer(data);
        final draft = _draft!;

        final warehouses = (data['warehouses'] is List)
            ? (data['warehouses'] as List)
                  .whereType<Map>()
                  .map((row) => Map<String, dynamic>.from(row))
                  .toList(growable: false)
            : const <Json>[];
        final restricted = draft.isNotEmpty;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      restricted
                          ? (arabic
                                ? 'مقيَّد بالمستودعات المحددة أدناه.'
                                : 'Restricted to the warehouses marked below.')
                          : (arabic
                                ? 'غير مقيَّد: يرى كل مستودعات فروعه. اختر مستودعًا لتقييده.'
                                : 'Unrestricted: sees every warehouse of their '
                                      'branches. Mark one to restrict them.'),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
                  if (_dirty)
                    Text(
                      arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  const SizedBox(width: 12),
                  if (widget.mayManage)
                    FilledButton.icon(
                      onPressed: _dirty && !_saving ? _save : null,
                      icon: const Icon(Icons.save_outlined, size: 18),
                      label: Text(arabic ? 'حفظ' : 'Save'),
                    ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                children: [
                  for (final warehouse in warehouses)
                    _warehouseCard(context, warehouse, draft),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _warehouseCard(
    BuildContext context,
    Json warehouse,
    Map<String, Map<String, dynamic>> draft,
  ) {
    final arabic = _arabic;
    final id = text(warehouse, 'id');
    final current = draft[id];
    final name = arabic ? text(warehouse, 'nameAr') : text(warehouse, 'nameEn');
    final granted = current != null;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${text(warehouse, 'code')} — $name',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Switch(
                  value: granted,
                  onChanged: widget.mayManage
                      ? (value) => _setGranted(id, value)
                      : null,
                ),
              ],
            ),
            if (granted)
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final key in _rights)
                    FilterChip(
                      label: Text(_right(key)),
                      selected: flag(current, key),
                      onSelected: widget.mayManage
                          ? (value) => _toggleRight(id, key, value)
                          : null,
                    ),
                ],
              )
            else
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  arabic
                      ? 'لا صلاحية: هذا المستودع غير مرئي له.'
                      : 'No right: this warehouse is not visible to them.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _setGranted(String warehouseId, bool granted) {
    setState(() {
      if (granted) {
        _draft![warehouseId] = {
          'warehouseId': warehouseId,
          for (final key in _rights) key: key == 'canView',
        };
      } else {
        _draft!.remove(warehouseId);
      }
      _dirty = true;
    });
  }

  void _toggleRight(String warehouseId, String key, bool value) {
    setState(() {
      final row = _draft!.putIfAbsent(
        warehouseId,
        () => {'warehouseId': warehouseId},
      );
      row[key] = value;
      // Any right switched on implies being able to see the warehouse; the
      // server treats canView false as no visibility at all.
      if (value) row['canView'] = true;
      _dirty = true;
    });
  }

  Future<void> _save() async {
    final arabic = _arabic;
    final grants = _draft!.values
        .map(
          (row) => {
            'warehouseId': row['warehouseId'],
            for (final key in _rights) key: flag(row, key),
          },
        )
        .toList(growable: false);

    final confirmed = await confirmAction(
      context,
      title: arabic ? 'حفظ الصلاحيات' : 'Save the rights',
      message: grants.isEmpty
          ? (arabic
                ? 'لن تبقى له صلاحيات خاصة، فيرى كل مستودعات فروعه.'
                : 'They will have no specific rights and will see every '
                      'warehouse of their branches.')
          : (arabic
                ? 'ستستبدل صلاحيات هذا المستخدم بالكامل بما هو معروض. المستودعات التي أُطفئت ستختفي من عرضه.'
                : "This person's grants will be replaced entirely by what "
                      'is shown. Warehouses switched off will disappear from '
                      'their view.'),
      confirmLabel: arabic ? 'حفظ' : 'Save',
    );
    if (!confirmed || !mounted) return;

    setState(() => _saving = true);
    try {
      await ref
          .read(apiClientProvider)
          .put(
            '/inventory/warehouse-access/${widget.userId}',
            body: {'grants': grants},
          );
      ref.invalidate(_accessProvider(widget.userId));
      if (!mounted) return;
      setState(() {
        _draft = null;
        _dirty = false;
      });
      showMessage(context, arabic ? 'تم الحفظ' : 'Saved');
    } catch (error) {
      if (!mounted) return;
      showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
