# folkbranch

Installs [Folkbranch](https://github.com/danarkhipov/folkbranch), a self-hosted family tree your whole family can use and your AI agents can safely edit.

```bash
npx folkbranch
```

This runs the same install script as `curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh`: the first run downloads the release for your system into ~/folkbranch and starts it; later runs open it. On Windows, use PowerShell: `irm https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.ps1 | iex`.

Everything else, including servers, Docker and backups, is in the [main README](https://github.com/danarkhipov/folkbranch#readme). Licence: AGPL-3.0.
