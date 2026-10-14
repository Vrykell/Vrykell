// Identity host for the sparse package.
//
// The manifest has to declare an <Application>, and declaring the real application there made
// Windows hand the package identity to every process with that image name: the end of a shell
// extension activation (which happens right after a right-click in Explorer) then terminated the
// package's processes and took the running application down with it. This host carries the
// identity instead, so shell activations never touch the application.
//
// The host is not an entry point a user launches: it only forwards an explicit activation to the
// application path the registration stored, which keeps "open the package" working without
// reintroducing the identity on the application itself.
#include <windows.h>
#include <shellapi.h>
#include <string>
#include "arguments.h"

namespace {

std::wstring registeredApplication() {
    wchar_t buffer[32768]{};
    DWORD bytes = sizeof(buffer);
    LSTATUS status = RegGetValueW(HKEY_CURRENT_USER, L"Software\\Vrykell\\ContextMenu", L"Executable",
        RRF_RT_REG_SZ, nullptr, buffer, &bytes);
    return status == ERROR_SUCCESS ? std::wstring(buffer) : std::wstring();
}

std::wstring forwardArguments() {
    std::wstring arguments;
    int count = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!argv) return arguments;
    for (int index = 1; index < count; ++index) {
        arguments += L' ';
        arguments += quoteProcessArgument(argv[index]);
    }
    LocalFree(argv);
    return arguments;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    const std::wstring executable = registeredApplication();
    if (executable.empty()) return 1;
    std::wstring commandLine = quoteProcessArgument(executable) + forwardArguments();
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
        nullptr, nullptr, &startup, &process)) {
        return 1;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 0;
}
