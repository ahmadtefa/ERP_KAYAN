from pathlib import Path

path = Path('lib/features/quotations/presentation/screens/quotation_editor_screen.dart')
text = path.read_text(encoding='utf-8')
marker = '  Widget _designCard(BuildContext context) {\n'
needle = marker + '    final l10n = context.l10n;\n'
if needle in text:
    text = text.replace(needle, marker, 1)
    path.write_text(text, encoding='utf-8')
    print('removed unused design-card l10n local')
else:
    print('design-card l10n local already absent')
