# PirateFly Fare Watch

A GitHub Action that watches flight routes on a schedule and tells you when a fare drops into the cheap range of **that route's own price history**, not just "today's price".

Every run writes a job summary; optionally it opens one issue per route when it becomes a deal (later deals comment on the same issue).

Data comes from the [PirateFly](https://piratefly.com/?src=gh-action) price-history API: percentile, median and the best booking window per route.

## Usage

```yaml
# .github/workflows/fare-watch.yml
name: fare watch
on:
  schedule:
    - cron: '0 7 * * *'   # every morning
  workflow_dispatch:
permissions:
  issues: write
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: DeusAcc/piratefly-fare-watch@v1
        with:
          routes: |
            Stockholm -> Rome
            London -> Edinburgh
            New York -> Paris
          level: good        # great = bottom 10% of history, good = bottom 35%
          open-issue: true
```

Example summary:

| Route | Verdict | Today / typical | Percentile |
|---|---|---|---|
| [Stockholm → Rome](https://piratefly.com/flights/stockholm-to-rome/?src=gh-action) | **good price** | €16 / €28 | 14 |
| London → Edinburgh | typical price | €41 / €45 | 58 |

## Inputs

| Input | Default | |
|---|---|---|
| `routes` | (required) | One `Origin -> Destination` per line, city names. |
| `level` | `good` | `great` or `good`. |
| `open-issue` | `false` | Open/update an issue per deal (needs `issues: write`). |
| `api-key` | | PirateFly Pro key, pass it as a secret. |

Outputs: `deals` (JSON array) and `count`, to chain Slack, email or anything else.

## Limits

Free: 30 route checks per day per IP, no signup. Watching many routes or running often? **Higher limits with [Pro](https://piratefly.com/api?src=gh-action)** ($12.99/month, no daily cap): `POST https://piratefly.com/v1/pro/checkout` with your email, then store the key as `PIRATEFLY_API_KEY` and add `api-key: ${{ secrets.PIRATEFLY_API_KEY }}`.

Other ways in: [REST API](https://piratefly.com/api?src=gh-action) · [MCP server](https://piratefly.com/mcp-server?src=gh-action) · [open dataset](https://huggingface.co/datasets/DeusHorizon/flight-fare-history).

MIT licensed.
