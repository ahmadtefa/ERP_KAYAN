#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <cstdio>

#include "flutter_window.h"
#include "utils.h"

namespace {

// Gives this program a console of its own, hidden.
//
// Flutter's window is not a console program, so when the packaged program
// starts its API server with Dart's Process.start, Windows has no console to
// give the child and creates one that is *visible* - a black window appearing
// behind the program, which is exactly what this feature exists to avoid.
// Allocating a hidden console here means every child process has somewhere to
// write and nothing appears on screen.
//
// When the program is started from a terminal (a developer running the exe by
// hand, or `flutter run`), the terminal's console is used instead, so the
// server's output stays where a developer expects to read it.
//
// See dart-lang/sdk#39945 for the behaviour this works around.
void AttachOrCreateConsole() {
  if (::AttachConsole(ATTACH_PARENT_PROCESS)) return;
  if (!::AllocConsole()) return;
  ::ShowWindow(::GetConsoleWindow(), SW_HIDE);

  FILE* stream = nullptr;
  freopen_s(&stream, "CONOUT$", "w", stdout);
  freopen_s(&stream, "CONOUT$", "w", stderr);
  freopen_s(&stream, "CONIN$", "r", stdin);
}

// Ties every process this program starts to its own lifetime.
//
// The API server is a child process. If the program is closed normally, the
// shell stops the server politely (see LocalBackend.shutdown in the client).
// If the program is killed - Task Manager, a crash, a power cut on the machine
// - the child would otherwise keep running and hold the database open. A job
// object with KILL_ON_JOB_CLOSE makes Windows end the whole family when the
// program's last handle closes, and children inherit membership automatically.
//
// Best effort: if the program is already inside a job that forbids nesting,
// the call fails and the polite shutdown path above is still there.
void JoinKillOnCloseJob() {
  HANDLE job = ::CreateJobObjectW(nullptr, nullptr);
  if (job == nullptr) return;

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!::SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                                 sizeof(limits))) {
    ::CloseHandle(job);
    return;
  }

  if (!::AssignProcessToJobObject(job, ::GetCurrentProcess())) {
    ::CloseHandle(job);
    return;
  }
  // The handle is deliberately left open for the life of the program: closing
  // it is what triggers the kill, and that happens when Windows ends this
  // process.
}

}  // namespace

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // A console for this program and for the processes it starts, without a
  // window: see AttachOrCreateConsole above.
  AttachOrCreateConsole();

  // Any process this program starts ends with it, even if it is killed.
  JoinKillOnCloseJob();

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(1280, 720);
  if (!window.Create(L"erp_kayan", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
