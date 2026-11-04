# RPM package for Folio, made from the files of the .rpm `tauri build` writes (scripts/rpm-repackage.sh).
# Tauri names that package "folio", like an unrelated GNOME app in Fedora's repos whose higher
# version made dnf replace Folio on upgrade (issue #4), so it is rebuilt under a name of its own.

%global debug_package %{nil}
%global _build_id_links none
# keep the files byte-for-byte: the in-app updater reads the bundle type stored in the binary
%global __os_install_post %{nil}

Name:           folio-markdown
Version:        %{_ver}
Release:        1
Summary:        A fast, seamless Markdown reader & editor
License:        LicenseRef-unknown
URL:            https://github.com/Sooeeren/folio
BuildArch:      x86_64
# Folio's own packages up to 0.4.1 were called "folio"; Fedora's folio (25.x and later) is not affected
Obsoletes:      folio < 0.4.2
Recommends:     xdg-desktop-portal

%description
Folio is a desktop Markdown reader and editor: documents are edited in their rendered form,
with the raw Markdown one shortcut away. Spelling and grammar check, PDF export with page
preview, source mode with Vim keybindings, themes.

%install
mkdir -p %{buildroot}
cp -a %{payload}/. %{buildroot}/

%files
/usr/bin/folio
/usr/share/applications/*.desktop
/usr/share/icons/hicolor/*/apps/folio.png
