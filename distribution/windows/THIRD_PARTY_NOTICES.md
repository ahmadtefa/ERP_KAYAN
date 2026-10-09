# Third-party components in the Windows package

The package contains components under their respective upstream terms. The builder also retains vendor license/notice files found beside the staged PostgreSQL and Node binaries, plus Flutter's generated asset notices.

- **Flutter engine/tool output**: BSD 3-Clause; notices are in the generated Flutter asset bundle.
- **Node.js 24 x64**: MIT license; the Node distribution's `LICENSE` file is copied into the package.
- **PostgreSQL 17 x64**: PostgreSQL License; the EDB binary archive and any included license/notice files are copied into the package.
- **Microsoft Visual C++ Redistributable x64**: Microsoft redistribution terms apply. The signed Microsoft redistributable is installed quietly as a prerequisite and is not modified.
- **NestJS, Prisma, Dart/Flutter packages, and npm production dependencies**: retain each package's upstream license and notice files in the staged dependency tree.
- **Inno Setup 6**: build-time compiler only; it is not installed on customer machines or bundled as a runtime.

Review each vendor's current license terms before publishing a commercial release. This notice is a locator, not a substitute for the upstream license texts.
