import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../data/presentation/providers/data_providers.dart';

/// One row in the barcode label job: a unit with its own barcode and how many
/// stickers to print for it.
class LabelUnitSelection {
  LabelUnitSelection({
    required this.unitId,
    required this.unitName,
    required this.barcode,
    required this.isActive,
    this.selected = false,
    this.copies = 1,
  });

  final String unitId;
  final String unitName;
  final String? barcode;
  final bool isActive;
  bool selected;
  int copies;

  bool get printable => barcode != null && barcode!.trim().isNotEmpty;
}

/// Chooses units, copy counts, paper size and the price option, then opens the
/// server-rendered label sheet (print view or PDF). The server keeps the rule
/// that a carton label carries the carton barcode and a piece label the piece
/// barcode; this dialog only collects which stickers are wanted.
class BarcodeLabelsDialog extends ConsumerStatefulWidget {
  const BarcodeLabelsDialog({
    super.key,
    required this.itemId,
    required this.itemName,
    required this.units,
  });

  final String itemId;
  final String itemName;
  final List<LabelUnitSelection> units;

  @override
  ConsumerState<BarcodeLabelsDialog> createState() => _BarcodeLabelsDialogState();
}

class _BarcodeLabelsDialogState extends ConsumerState<BarcodeLabelsDialog> {
  String _paper = 'A4';
  bool _showPrice = true;
  bool _working = false;

  List<LabelUnitSelection> get _selected =>
      widget.units.where((unit) => unit.selected && unit.printable).toList();

  int get _totalLabels =>
      _selected.fold<int>(0, (sum, unit) => sum + unit.copies);

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _working = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final links = ref.read(reportLinkProvider);
    final specs = _selected
        .map((unit) => (unitId: unit.unitId, copies: unit.copies))
        .toList(growable: false);
    final papers = <String, String>{
      'A4': l10n.barcodeLabelsPaperA4,
      'THERMAL_80': l10n.barcodeLabelsPaperThermal80,
      'THERMAL_58': l10n.barcodeLabelsPaperThermal58,
    };

    return AlertDialog(
      title: Text(l10n.barcodeLabelsTitle(widget.itemName)),
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final unit in widget.units)
                    CheckboxListTile(
                      dense: true,
                      value: unit.selected,
                      onChanged: unit.printable
                          ? (value) => setState(() => unit.selected = value ?? false)
                          : null,
                      title: Text(
                        unit.isActive
                            ? unit.unitName
                            : l10n.barcodeLabelsInactiveUnit(unit.unitName),
                        style: unit.isActive
                            ? null
                            : const TextStyle(color: Colors.grey),
                      ),
                      subtitle: Text(
                        unit.printable
                            ? l10n.barcodeLabelsBarcode(unit.barcode ?? '')
                            : l10n.barcodeLabelsNoBarcode,
                      ),
                      secondary: unit.printable
                          ? SizedBox(
                              width: 90,
                              child: TextFormField(
                                initialValue: '${unit.copies}',
                                enabled: unit.selected,
                                keyboardType: TextInputType.number,
                                decoration: InputDecoration(
                                  labelText: l10n.barcodeLabelsCopies,
                                  isDense: true,
                                ),
                                onChanged: (value) {
                                  final parsed = int.tryParse(value);
                                  if (parsed != null && parsed >= 1 && parsed <= 500) {
                                    setState(() => unit.copies = parsed);
                                  }
                                },
                              ),
                            )
                          : null,
                    ),
                ],
              ),
            ),
            const Divider(),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _paper,
                    decoration: InputDecoration(labelText: l10n.barcodeLabelsPaper),
                    items: [
                      for (final entry in papers.entries)
                        DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                    ],
                    onChanged: (value) => setState(() => _paper = value ?? 'A4'),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.barcodeLabelsShowPrice),
                    value: _showPrice,
                    onChanged: (value) => setState(() => _showPrice = value),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _working ? null : () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
        OutlinedButton.icon(
          icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
          label: Text(l10n.barcodeLabelsPdf),
          onPressed: (_working || specs.isEmpty)
              ? null
              : () => _run(() => runDownload(
                    context,
                    links.barcodeLabelPdf(
                      itemId: widget.itemId,
                      specs: specs,
                      language: language,
                      paper: _paper,
                      showPrice: _showPrice,
                    ),
                  )),
        ),
        FilledButton.icon(
          icon: const Icon(Icons.print_outlined, size: 18),
          label: Text(
            _totalLabels > 0
                ? l10n.barcodeLabelsPrintCount(_totalLabels)
                : l10n.barcodeLabelsPrint,
          ),
          onPressed: (_working || specs.isEmpty)
              ? null
              : () async {
                  await _run(() => runPrint(
                        context,
                        links.barcodeLabelPrint(
                          itemId: widget.itemId,
                          specs: specs,
                          language: language,
                          paper: _paper,
                          showPrice: _showPrice,
                        ),
                      ));
                  if (context.mounted) Navigator.of(context).pop();
                },
        ),
      ],
    );
  }
}
