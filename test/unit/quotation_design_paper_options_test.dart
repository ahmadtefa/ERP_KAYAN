import 'package:flutter_test/flutter_test.dart';
import 'package:erp_kayan/features/quotations/presentation/document/quotation_document.dart';

void main() {
  test('paper options survive json round trip and style edits', () {
    final d = QuotationDocumentDesign.defaultDesign().withLetterhead(
      hideHeader: true,
      hideFooter: true,
      backgroundId: '11111111-1111-1111-1111-111111111111',
      backgroundName: 'letterhead.pdf',
    );
    final back = QuotationDocumentDesign.fromJson(d.toJson());
    expect(back.hideHeader, isTrue);
    expect(back.hideFooter, isTrue);
    expect(back.backgroundId, '11111111-1111-1111-1111-111111111111');
    final styled = back.withStyle('title', const QuotationDocumentElementStyle());
    expect(styled.hideHeader, isTrue);
    expect(styled.backgroundName, 'letterhead.pdf');
    expect(styled.withLetterhead(clearBackground: true).toJson().containsKey('backgroundId'), isFalse);
  });
}
