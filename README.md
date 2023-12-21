# tsa-plugin-az

Azure plugin for [tsa](https://github.com/randymarsh77/tsa-cli).

## Installation

```
$ npm i -g @tsa-tools/cli tsa-plugin-az
```

This tool instruments `az` and will use all the defaults configured by `az`.

## Usage

Defaults to CPU stats and matches all VM resources according to `az` defaults (subscription, resource-group).
```
$ tsa --plugin tsa-plugin-az
```

Or, set this plugin as default and omit the argument from future calls.
```
$ tsa config --default plugin=tsa-plugin-az
$ tsa
```

### Plugin specific options
| Flag   | Values |
| ------ | ------ |
| `--metric` | One of `cpu` or `ram` or `disk` |
| `--resource-group` | forwards to `az` |
| `--resource-type` | forwards to `az` |
| `--filter` | regex filter on resource name |

### Standard `tsa` options
| Flag     | Values |
| -------- | -------- |
| `--since` | [timestring](https://www.npmjs.com/package/timestring) relative to `now` or `--until`, when to start the query time range |
| `--until` | [timestring](https://www.npmjs.com/package/timestring) relative to `now`, when to end the query time range |
