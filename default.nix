with import <nixpkgs> {};
mkShell {
  packages = [
    bashInteractive
    nodejs
  ];
}
