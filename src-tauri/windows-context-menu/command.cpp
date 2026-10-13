#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <wrl/client.h>
#include <atomic>
#include <new>
#include <string>
#include "arguments.h"

using Microsoft::WRL::ComPtr;
static HMODULE module;
static std::atomic<long> objects{0};
static const GUID commandId = {0x8d41ba19, 0x3b2f, 0x4d6d, {0xa9, 0x6b, 0xfe, 0x3a, 0xd0, 0xec, 0x58, 0x21}};

static HRESULT folderFromSite(IUnknown* site, IShellItem** item) {
    if (!site) return E_FAIL;
    ComPtr<IServiceProvider> services;
    HRESULT hr = site->QueryInterface(IID_PPV_ARGS(&services));
    if (FAILED(hr)) return hr;
    ComPtr<IFolderView> view;
    hr = services->QueryService(SID_SFolderView, IID_PPV_ARGS(&view));
    if (FAILED(hr)) return hr;
    ComPtr<IPersistFolder2> folder;
    hr = view->GetFolder(IID_PPV_ARGS(&folder));
    if (FAILED(hr)) return hr;
    PIDLIST_ABSOLUTE pidl = nullptr;
    hr = folder->GetCurFolder(&pidl);
    if (SUCCEEDED(hr)) hr = SHCreateItemFromIDList(pidl, IID_PPV_ARGS(item));
    CoTaskMemFree(pidl);
    return hr;
}

class FolderCommand final : public IExplorerCommand, public IObjectWithSite {
    std::atomic<ULONG> references{1};
    ComPtr<IUnknown> site;
public:
    FolderCommand() { ++objects; }
    ~FolderCommand() { --objects; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (iid == IID_IUnknown || iid == IID_IExplorerCommand) *value = static_cast<IExplorerCommand*>(this);
        else if (iid == IID_IObjectWithSite) *value = static_cast<IObjectWithSite*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG count = --references;
        if (!count) delete this;
        return count;
    }
    HRESULT STDMETHODCALLTYPE SetSite(IUnknown* value) override { site = value; return S_OK; }
    HRESULT STDMETHODCALLTYPE GetSite(REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        return site ? site->QueryInterface(iid, value) : E_FAIL;
    }
    HRESULT STDMETHODCALLTYPE GetTitle(IShellItemArray*, PWSTR* value) override {
        if (!value) return E_POINTER;
        wchar_t title[256]{};
        if (!LoadStringW(module, 102, title, 256)) return SHStrDupW(L"Open in Vrykell", value);
        return SHStrDupW(title, value);
    }
    HRESULT STDMETHODCALLTYPE GetIcon(IShellItemArray*, PWSTR* value) override {
        if (!value) return E_POINTER;
        wchar_t path[32768]{};
        DWORD length = GetModuleFileNameW(module, path, 32768);
        if (!length || length >= 32768) { *value = nullptr; return E_FAIL; }
        try { return SHStrDupW((std::wstring(path) + L",-101").c_str(), value); }
        catch (...) { *value = nullptr; return E_OUTOFMEMORY; }
    }
    HRESULT STDMETHODCALLTYPE GetToolTip(IShellItemArray*, PWSTR* value) override {
        if (!value) return E_POINTER;
        *value = nullptr; return E_NOTIMPL;
    }
    HRESULT STDMETHODCALLTYPE GetCanonicalName(GUID* value) override {
        if (!value) return E_POINTER;
        *value = commandId; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetState(IShellItemArray* items, BOOL, EXPCMDSTATE* value) override {
        if (!value) return E_POINTER;
        *value = ECS_HIDDEN;
        if (!items) { *value = ECS_ENABLED; return S_OK; }
        DWORD count = 0;
        if (FAILED(items->GetCount(&count))) return S_OK;
        if (count == 0) { *value = ECS_ENABLED; return S_OK; }
        if (count != 1) return S_OK;
        SFGAOF attributes = 0;
        if (SUCCEEDED(items->GetAttributes(SIATTRIBFLAGS_AND, SFGAO_FILESYSTEM | SFGAO_FOLDER, &attributes))
            && (attributes & (SFGAO_FILESYSTEM | SFGAO_FOLDER)) == (SFGAO_FILESYSTEM | SFGAO_FOLDER)) *value = ECS_ENABLED;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Invoke(IShellItemArray* items, IBindCtx*) override {
        try {
            ComPtr<IShellItem> item;
            HRESULT hr;
            if (items) {
                DWORD count = 0;
                hr = items->GetCount(&count);
                if (FAILED(hr) || count > 1) return E_INVALIDARG;
                hr = count == 1 ? items->GetItemAt(0, &item) : folderFromSite(site.Get(), &item);
            } else hr = folderFromSite(site.Get(), &item);
            if (FAILED(hr)) return hr;
            SFGAOF attributes = 0;
            hr = item->GetAttributes(SFGAO_FILESYSTEM | SFGAO_FOLDER, &attributes);
            if (FAILED(hr) || (attributes & (SFGAO_FILESYSTEM | SFGAO_FOLDER)) != (SFGAO_FILESYSTEM | SFGAO_FOLDER)) return E_INVALIDARG;
            PWSTR raw = nullptr;
            hr = item->GetDisplayName(SIGDN_FILESYSPATH, &raw);
            if (FAILED(hr)) return hr;
            std::wstring folder;
            try { folder.assign(raw); } catch (...) { CoTaskMemFree(raw); throw; }
            CoTaskMemFree(raw);
            wchar_t executable[32768]{};
            DWORD bytes = sizeof(executable);
            LSTATUS status = RegGetValueW(HKEY_CURRENT_USER, L"Software\\Vrykell\\ContextMenu", L"Executable",
                RRF_RT_REG_SZ, nullptr, executable, &bytes);
            if (status != ERROR_SUCCESS) return HRESULT_FROM_WIN32(status);
            std::wstring args = quoteProcessArgument(executable) + L" --open-directory " + quoteProcessArgument(folder);
            STARTUPINFOW startup{}; startup.cb = sizeof(startup);
            PROCESS_INFORMATION process{};
            if (!CreateProcessW(executable, args.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                nullptr, nullptr, &startup, &process)) return HRESULT_FROM_WIN32(GetLastError());
            CloseHandle(process.hThread); CloseHandle(process.hProcess);
            return S_OK;
        } catch (...) { return E_OUTOFMEMORY; }
    }
    HRESULT STDMETHODCALLTYPE GetFlags(EXPCMDFLAGS* value) override {
        if (!value) return E_POINTER;
        *value = ECF_DEFAULT; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE EnumSubCommands(IEnumExplorerCommand** value) override {
        if (!value) return E_POINTER;
        *value = nullptr; return E_NOTIMPL;
    }
};

class Factory final : public IClassFactory {
    std::atomic<ULONG> references{1};
public:
    Factory() { ++objects; }
    ~Factory() { --objects; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (iid != IID_IUnknown && iid != IID_IClassFactory) return E_NOINTERFACE;
        *value = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
    ULONG STDMETHODCALLTYPE Release() override { ULONG count = --references; if (!count) delete this; return count; }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        auto* command = new (std::nothrow) FolderCommand();
        if (!command) return E_OUTOFMEMORY;
        HRESULT hr = command->QueryInterface(iid, value); command->Release(); return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override { if (lock) ++objects; else --objects; return S_OK; }
};

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** value) {
    if (!value) return E_POINTER;
    *value = nullptr;
    if (clsid != commandId) return CLASS_E_CLASSNOTAVAILABLE;
    auto* factory = new (std::nothrow) Factory();
    if (!factory) return E_OUTOFMEMORY;
    HRESULT hr = factory->QueryInterface(iid, value); factory->Release(); return hr;
}
extern "C" HRESULT __stdcall DllCanUnloadNow() { return objects.load() == 0 ? S_OK : S_FALSE; }
BOOL WINAPI DllMain(HINSTANCE handle, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { module = handle; DisableThreadLibraryCalls(handle); }
    return TRUE;
}
