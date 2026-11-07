import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// The warehouses offered in the picker, including retired ones so a person
/// can still see where old stock sits.
final _warehouseOptionsProvider = FutureProvider<List<Json>>((ref) async {
  return ref
      .read(apiClientProvider)
      .getList(
        '/inventory/warehouses',
        query: const {'includeInactive': 'true'},
      );
});

/// Which warehouse the tree is showing. Null means "the first one", which is
/// resolved by the screen so a single-warehouse company never sees a choice.
class _SelectedWarehouse extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? id) => state = id;
}

final _selectedWarehouseProvider =
    NotifierProvider<_SelectedWarehouse, String?>(_SelectedWarehouse.new);

/// The locations inside the selected warehouse.
///
/// `GET /inventory/locations` filters by the caller's branch scope on the
/// server, so the picker cannot be used to read another branch's shelves.
final storageLocationsProvider =
    AsyncNotifierProvider<StorageLocationsController, List<Json>>(
      StorageLocationsController.new,
    );

class StorageLocationsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/locations';

  /// The warehouse whose shelves are shown.
  ///
  /// A person who has not chosen gets the first warehouse they can see, so a
  /// single-warehouse company never meets an empty picker. There is no state to
  /// fall out of step here: both the dropdown and the request derive the id the
  /// same way, and the controller re-runs when either input changes.
  String? _warehouseId() {
    final chosen = ref.watch(_selectedWarehouseProvider);
    if (chosen != null) return chosen;
    final warehouses = ref.watch(_warehouseOptionsProvider).value;
    if (warehouses == null || warehouses.isEmpty) return null;
    return text(warehouses.first, 'id');
  }

  @override
  Future<List<Json>> build() {
    // `watch`, not `read`: choosing another warehouse must re-run the request.
    // An unfiltered request while nothing has been chosen would list the
    // shelves of every warehouse in the company under one picker entry.
    final warehouseId = _warehouseId();
    if (warehouseId == null) return Future.value(const <Json>[]);
    return super.build();
  }

  @override
  Map<String, dynamic> get resourceQuery => {
    if (_warehouseId() case final id?) 'warehouseId': id,
  };
}

/// The five kinds a location may be, in the order they nest.
const _kinds = ['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'];

class StorageLocationsScreen extends ConsumerWidget {
  const StorageLocationsScreen({super.key});

  bool _arabic(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'ar';

  String _label(BuildContext context, String kind) {
    final arabic = _arabic(context);
    return switch (kind) {
      'ZONE' => arabic ? 'منطقة' : 'Zone',
      'AISLE' => arabic ? 'ممر' : 'Aisle',
      'RACK' => arabic ? 'رف' : 'Rack',
      'SHELF' => arabic ? 'طبقة' : 'Shelf',
      _ => arabic ? 'خانة' : 'Bin',
    };
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final arabic = _arabic(context);
    final warehouses = ref.watch(_warehouseOptionsProvider);
    final canManage =
        ref.watch(currentUserProvider)?.can('inventory.warehouses.manage') ??
        false;
    final selected = ref.watch(_selectedWarehouseProvider);

    return ModuleScaffold(
      title: arabic ? 'مواقع التخزين' : 'Storage locations',
      eyebrow: arabic ? 'المخزون' : 'Inventory',
      trailing: canManage
          ? FilledButton.icon(
              onPressed: () => _openForm(context, ref, null),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: Text(arabic ? 'موقع جديد' : 'New location'),
            )
          : null,
      body: AsyncStateView<List<Json>>(
        value: warehouses,
        onRetry: () => ref.invalidate(_warehouseOptionsProvider),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: arabic
            ? 'لا توجد مستودعات بعد. أنشئ مستودعًا أولًا.'
            : 'No warehouses yet. Create a warehouse first.',
        data: (rows) {
          final active = selected ?? text(rows.first, 'id');
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: DropdownButton<String>(
                    value: rows.any((r) => text(r, 'id') == active)
                        ? active
                        : text(rows.first, 'id'),
                    isDense: true,
                    items: [
                      for (final row in rows)
                        DropdownMenuItem(
                          value: text(row, 'id'),
                          child: Text(
                            '${text(row, 'code')} — '
                            '${arabic ? text(row, 'nameAr') : text(row, 'nameEn')}',
                          ),
                        ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      ref.read(_selectedWarehouseProvider.notifier).state =
                          value;
                      ref.invalidate(storageLocationsProvider);
                    },
                  ),
                ),
              ),
              Expanded(
                child: Consumer(
                  builder: (context, ref, _) {
                    final locations = ref.watch(storageLocationsProvider);
                    return AsyncStateView<List<Json>>(
                      value: locations,
                      onRetry: () =>
                          ref.read(storageLocationsProvider.notifier).reload(),
                      isEmpty: (list) => list.isEmpty,
                      emptyMessage: arabic
                          ? 'لا توجد مواقع في هذا المستودع.'
                          : 'No locations in this warehouse.',
                      data: (list) => RecordsTable(
                        rows: list,
                        columns: [
                          ColumnSpec(
                            arabic ? 'الكود' : 'Code',
                            value: (r) => text(r, 'code'),
                            emphasise: true,
                          ),
                          ColumnSpec(
                            arabic ? 'الاسم' : 'Name',
                            value: (r) => arabic
                                ? text(r, 'nameAr')
                                : text(r, 'nameEn'),
                          ),
                          ColumnSpec(
                            arabic ? 'النوع' : 'Kind',
                            value: (r) => _label(context, text(r, 'kind')),
                          ),
                          ColumnSpec(
                            arabic ? 'الأصناف' : 'Items',
                            numeric: true,
                            value: (r) {
                              final stock = r['stock'];
                              if (stock is! Map) return '0';
                              return asString(
                                    Map<String, dynamic>.from(stock)['items'],
                                  ) ??
                                  '0';
                            },
                          ),
                          ColumnSpec(
                            arabic ? 'الكمية' : 'Quantity',
                            numeric: true,
                            value: (r) {
                              final stock = r['stock'];
                              if (stock is! Map) return formatQuantity('0');
                              return formatQuantity(
                                asString(
                                  Map<String, dynamic>.from(stock)['quantity'],
                                ),
                              );
                            },
                          ),
                          ColumnSpec(
                            l10n.status,
                            value: (r) => flag(r, 'isActive', fallback: true)
                                ? (arabic ? 'نشط' : 'Active')
                                : (arabic ? 'موقوف' : 'Inactive'),
                          ),
                        ],
                        actions: canManage
                            ? (row) => [
                                IconButton(
                                  tooltip: l10n.edit,
                                  icon: const Icon(Icons.edit_outlined),
                                  onPressed: () =>
                                      _openForm(context, ref, row),
                                ),
                                IconButton(
                                  tooltip: arabic ? 'حذف' : 'Delete',
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: () => _remove(context, ref, row),
                                ),
                              ]
                            : null,
                      ),
                    );
                  },
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _openForm(
    BuildContext context,
    WidgetRef ref,
    Json? row,
  ) async {
    final arabic = _arabic(context);
    // The screen always resolves a warehouse before the form can be opened,
    // so the fallback here is the same first row the dropdown shows.
    final options = ref.read(_warehouseOptionsProvider).value;
    final warehouseId =
        ref.read(_selectedWarehouseProvider) ??
        (options == null || options.isEmpty ? null : text(options.first, 'id'));
    if (warehouseId == null) return;

    final submitted = await showFormSheet(
      context,
      title: row == null
          ? (arabic ? 'موقع جديد' : 'New location')
          : (arabic ? 'تعديل الموقع' : 'Edit location'),
      submitLabel: arabic ? 'حفظ' : 'Save',
      initial: row == null ? {'warehouseId': warehouseId} : row,
      fields: [
        FieldSpec(
          'code',
          arabic ? 'الكود' : 'Code',
          required: true,
        ),
        FieldSpec(
          'nameEn',
          arabic ? 'الاسم بالإنجليزية' : 'Name (English)',
          required: true,
        ),
        FieldSpec(
          'nameAr',
          arabic ? 'الاسم بالعربية' : 'Name (Arabic)',
          required: true,
        ),
        FieldSpec(
          'kind',
          arabic ? 'النوع' : 'Kind',
          kind: FieldKind.select,
          required: true,
          emptyValue: 'BIN',
          options: [
            for (final kind in _kinds)
              FieldOption(kind, _label(context, kind)),
          ],
        ),
      ],
      onSubmit: (values) async {
        final api = ref.read(apiClientProvider);
        if (row == null) {
          await api.post('/inventory/locations', body: {
            ...values,
            'warehouseId': warehouseId,
          });
        } else {
          await api.patch('/inventory/locations/${text(row, 'id')}', body: values);
        }
        await ref.read(storageLocationsProvider.notifier).refreshQuietly();
      },
    );
    if (submitted == null || !context.mounted) return;
    showMessage(context, arabic ? 'تم الحفظ' : 'Saved');
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, Json row) async {
    final arabic = _arabic(context);
    final confirmed = await confirmAction(
      context,
      title: arabic ? 'حذف الموقع' : 'Delete location',
      message: arabic
          ? 'سيُخفى الموقع «${text(row, 'code')}» من الاختيار. الكميات المسجّلة عليه لا تُمسّ.'
          : 'The location "${text(row, 'code')}" will be hidden from the picker. '
                'Stock recorded against it is not touched.',
      confirmLabel: arabic ? 'حذف' : 'Delete',
      destructive: true,
    );
    if (!confirmed || !context.mounted) return;
    try {
      await ref
          .read(apiClientProvider)
          .delete('/inventory/locations/${text(row, 'id')}');
      await ref.read(storageLocationsProvider.notifier).refreshQuietly();
      if (!context.mounted) return;
      showMessage(context, arabic ? 'تم الحذف' : 'Deleted');
    } catch (error) {
      if (!context.mounted) return;
      showMessage(context, error, error: true);
    }
  }
}
