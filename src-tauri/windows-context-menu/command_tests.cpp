#include <windows.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <wrl/client.h>
#include <cstdio>
#include "arguments.h"

using Microsoft::WRL::ComPtr;
static const GUID commandId = {0x8d41ba19, 0x3b2f, 0x4d6d, {0xa9, 0x6b, 0xfe, 0x3a, 0xd0, 0xec, 0x58, 0x21}};
#define CHECK(value) do { if (!(value)) { std::fprintf(stderr, "Failed at line %d\n", __LINE__); return 1; } } while (false)

int wmain(int argc, wchar_t** argv) {
    CHECK(argc == 2);
    CHECK(SUCCEEDED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)));
    for (const auto& path : { L"C:\\", L"C:\\Work space\\\x9879\x76ee & notes", L"\\\\server\\share\\", L"C:\\it's\\folder" }) {
        const std::wstring line = L"app " + quoteProcessArgument(path);
        int count = 0;
        PWSTR* parsed = CommandLineToArgvW(line.c_str(), &count);
        CHECK(parsed && count == 2 && wcscmp(parsed[1], path) == 0);
        LocalFree(parsed);
    }
    if (wcscmp(argv[1], L"--registered") == 0) {
        ComPtr<IExplorerCommand> command;
        HRESULT hr = CoCreateInstance(commandId, nullptr, CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&command));
        if (FAILED(hr)) std::fprintf(stderr, "COM activation HRESULT: %08lx\n", static_cast<unsigned long>(hr));
        CHECK(SUCCEEDED(hr));
        PWSTR title = nullptr;
        CHECK(SUCCEEDED(command->GetTitle(nullptr, &title)) && title && *title);
        CoTaskMemFree(title);
        std::puts("Registered COM activation passed.");
        return 0;
    }
    HMODULE dll = LoadLibraryW(argv[1]); CHECK(dll);
    auto getClass = reinterpret_cast<HRESULT(__stdcall*)(REFCLSID, REFIID, void**)>(GetProcAddress(dll, "DllGetClassObject"));
    auto canUnload = reinterpret_cast<HRESULT(__stdcall*)()>(GetProcAddress(dll, "DllCanUnloadNow"));
    CHECK(getClass && canUnload && canUnload() == S_OK);
    {
        ComPtr<IClassFactory> factory;
        CHECK(SUCCEEDED(getClass(commandId, IID_PPV_ARGS(&factory))));
        ComPtr<IExplorerCommand> command;
        CHECK(SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&command))));
        CHECK(canUnload() == S_FALSE);
        CHECK(command->GetTitle(nullptr, nullptr) == E_POINTER);
        PWSTR title = nullptr; CHECK(SUCCEEDED(command->GetTitle(nullptr, &title)) && title && *title); CoTaskMemFree(title);
        PWSTR icon = nullptr; CHECK(SUCCEEDED(command->GetIcon(nullptr, &icon)) && icon && wcsstr(icon, L",-101")); CoTaskMemFree(icon);
        EXPCMDSTATE state; CHECK(SUCCEEDED(command->GetState(nullptr, FALSE, &state)) && state == ECS_ENABLED);
        ComPtr<IObjectWithSite> site; CHECK(SUCCEEDED(command.As(&site)));
        CHECK(SUCCEEDED(site->SetSite(nullptr)));
        CHECK(FAILED(command->Invoke(nullptr, nullptr)));
        wchar_t path[MAX_PATH]{}; CHECK(GetTempPathW(MAX_PATH, path));
        ComPtr<IShellItem> item; CHECK(SUCCEEDED(SHCreateItemFromParsingName(path, nullptr, IID_PPV_ARGS(&item))));
        ComPtr<IShellItemArray> items; CHECK(SUCCEEDED(SHCreateShellItemArrayFromShellItem(item.Get(), IID_PPV_ARGS(&items))));
        CHECK(SUCCEEDED(command->GetState(items.Get(), FALSE, &state)) && state == ECS_ENABLED);
        GUID name{}; CHECK(SUCCEEDED(command->GetCanonicalName(&name)) && name == commandId);
    }
    CHECK(canUnload() == S_OK);
    FreeLibrary(dll); CoUninitialize();
    std::puts("Native context menu tests passed.");
    return 0;
}
