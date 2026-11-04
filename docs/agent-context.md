# Agent context

## Purpose

Jeview is a local-only visualizer and gateway for TypeSafe AI's Jev System One API. Client requests go to Jeview, Jeview forwards them with the stored TypeSafe key, records the request and response in SQLite, and renders the call graph in the browser.

## Runtime shape

- `src/jeview.ts`: HTTP server, loopback/host checks, Jev proxy, SQLite store, read APIs, and generated `llms.txt` text.
- `jeview.ts`: CLI entry point and argument parsing.
- `ui/index.html`: viewer shell and panels.
- `ui/app.js`: canvas graph, polling, drawers, settings, search, and direct chat behavior.
- `ui/app.css`: all viewer styling, including light/dark themes and responsive layout.
- `test/jeview.test.ts`: server contract tests using a stand-in Jev endpoint.
- `demo/`: real-call demos. Do not run them casually because they use the configured TypeSafe key.

There are no runtime dependencies. Node 24+ runs the TypeScript directly by stripping types. Keep server and browser code compatible with that constraint.

## Direct chat

The viewer has a left-side chat panel opened by the speech-bubble button. It sends requests to `/v1/systemone`, so calls are recorded and drawn on the map like any other call.

TypeSafe's current public System One schema supports `noul`, `choice`, `score`, and `box` questions, not free-form text generation. The chat panel therefore asks yes/no questions with a `noul` question and displays `Yes` or `No`. Do not change it back to a made-up `text` question type: that returns HTTP 400 even when the API key is valid.

The panel's request shape is:

```json
{
  "model": "jev-latest",
  "state": "the user's yes/no question",
  "questions": {
    "answer": {
      "type": "noul",
      "instructions": "the user's yes/no question"
    }
  }
}
```

## Development

```sh
npm install
npm run check:pages
npm run typecheck
npm test
```

Start locally with `./launch.sh`, or `JEVIEW_NO_OPEN=1 ./launch.sh` when another process should open the browser. The default viewer is `http://127.0.0.1:4777/`.

## Continuation priorities

1. Preserve loopback-only behavior and the no-runtime-dependencies rule.
2. Add server tests for new HTTP behavior and browser syntax checks for UI changes.
3. Keep recorded request bodies byte-for-byte intact when changing the proxy.
4. Never log, return, or commit the TypeSafe key. The SQLite setting intentionally stores it locally for the running instance.
5. If free-form chat becomes available in the TypeSafe API, update the chat request and this document together, then verify against the live API schema.
