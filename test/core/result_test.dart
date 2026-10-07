import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/result/result.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Result', () {
    test('Success exposes its value and no failure', () {
      const result = Success<int>(42);
      expect(result.isSuccess, isTrue);
      expect(result.isFailure, isFalse);
      expect(result.valueOrNull, 42);
      expect(result.failureOrNull, isNull);
    });

    test('ResultFailure exposes its failure and no value', () {
      const result = ResultFailure<int>(NetworkFailure());
      expect(result.isFailure, isTrue);
      expect(result.valueOrNull, isNull);
      expect(result.failureOrNull, isA<NetworkFailure>());
    });

    test('when dispatches to exactly one branch', () {
      String describe(Result<int> result) => result.when(
        success: (value) => 'ok:$value',
        failure: (failure) => 'err:${failure.runtimeType}',
      );

      expect(describe(const Success(7)), 'ok:7');
      expect(describe(const ResultFailure(AuthFailure())), 'err:AuthFailure');
    });
  });

  group('Failure', () {
    test('carries a message and optional cause', () {
      final error = Exception('socket closed');
      final failure = ServerFailure('boom', error);
      expect(failure.message, 'boom');
      expect(failure.cause, error);
    });

    test('ApiFailure keeps the status code', () {
      const failure = ApiFailure('rejected', statusCode: 422);
      expect(failure.statusCode, 422);
    });

    test('sealed hierarchy is exhaustively switchable', () {
      String classify(Failure failure) => switch (failure) {
        NetworkFailure() => 'network',
        AuthFailure() => 'auth',
        ApiFailure() => 'api',
        ServerFailure() => 'server',
        ValidationFailure() => 'validation',
      };
      expect(classify(const NetworkFailure()), 'network');
      expect(classify(const ValidationFailure('bad')), 'validation');
    });
  });
}
