import 'package:flutter_test/flutter_test.dart';
import 'package:erp_kayan/core/error/failure.dart';
void main() {
  const code='CUSTOMER_CREDIT_LIMIT_EXCEEDED';
  const valid={'creditLimit':'1000.0000','currentBalance':'-2.0000','invoiceAmount':'400.0000','projectedBalance':'398.0000'};
  test('credit summary requires exact refusal and all finite decimal strings', () {
    expect(CreditSummary.fromProblem(valid,code)?.currentBalance,'-2.0000');
    expect(CreditSummary.fromProblem(valid,'OTHER'),isNull);
    expect(CreditSummary.fromProblem(null,code),isNull);
    for(final bad in ['NaN','Infinity','1e3','1234567890123456','1.12345',1,null]) {
      expect(CreditSummary.fromProblem({...valid,'creditLimit':bad},code),isNull);
    }
    expect(CreditSummary.fromProblem({'creditLimit':'1'},code),isNull);
  });
}
