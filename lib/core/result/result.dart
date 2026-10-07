import '../error/failure.dart';

/// A minimal Result type used by repositories so callers must acknowledge
/// both success and failure paths without relying on thrown exceptions.
sealed class Result<T> {
  const Result();

  bool get isSuccess => this is Success<T>;
  bool get isFailure => this is ResultFailure<T>;

  T? get valueOrNull => switch (this) {
        Success<T>(:final value) => value,
        ResultFailure<T>() => null,
      };

  Failure? get failureOrNull => switch (this) {
        Success<T>() => null,
        ResultFailure<T>(:final failure) => failure,
      };

  R when<R>({
    required R Function(T value) success,
    required R Function(Failure failure) failure,
  }) {
    return switch (this) {
      Success<T>(:final value) => success(value),
      ResultFailure<T>(failure: final f) => failure(f),
    };
  }
}

final class Success<T> extends Result<T> {
  const Success(this.value);
  final T value;
}

final class ResultFailure<T> extends Result<T> {
  const ResultFailure(this.failure);
  final Failure failure;
}
