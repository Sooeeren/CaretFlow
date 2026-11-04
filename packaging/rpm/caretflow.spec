# RPM package for CaretFlow, made from the files of the .rpm `tauri build` writes (scripts/rpm-repackage.sh).
# Tauri would name it after the product ("caret-flow"); it is rebuilt as "caretflow" so the name matches the
# other packages and it can replace Folio's old packages ("folio" until 0.4.1, then "folio-markdown").

%global debug_package %{nil}
%global _build_id_links none
# keep the files byte-for-byte: the in-app updater reads the bundle type stored in the binary
%global __os_install_post %{nil}

Name:           caretflow
Version:        %{_ver}
Release:        1
Summary:        A fast, seamless Markdown reader & editor
License:        LicenseRef-unknown
URL:            https://github.com/Sooeeren/folio
BuildArch:      x86_64
# CaretFlow was called Folio until 0.5.0. Its packages up to 0.4.1 were called "folio" (versioned, so
# Fedora's unrelated folio 25.x and later is not affected), 0.4.2 and 0.5.0 were "folio-markdown"
Obsoletes:      folio < 0.4.2
Obsoletes:      folio-markdown < 0.6.0
Provides:       folio-markdown = %{version}
Recommends:     xdg-desktop-portal

%description
CaretFlow (formerly Folio) is a desktop Markdown reader and editor: documents are edited in their
rendered form, with the raw Markdown one shortcut away. Spelling and grammar check, PDF export with
page preview, source mode with Vim keybindings, themes.

%install
mkdir -p %{buildroot}
cp -a %{payload}/. %{buildroot}/

%files
/usr/bin/caretflow
/usr/share/applications/*.desktop
/usr/share/icons/hicolor/*/apps/caretflow.png
