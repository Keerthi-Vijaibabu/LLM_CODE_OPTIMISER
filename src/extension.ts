import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "llmCOptimizer.optimize",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "llmCOptimizer",
        "LLM C Optimizer",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      // HTML content for webview
      panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

      // When webview posts message
      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "requestCurrentCode":
              {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                  panel.webview.postMessage({ kind: "noEditor" });
                  return;
                }
                const doc = editor.document;
                panel.webview.postMessage({
                  kind: "currentCode",
                  languageId: doc.languageId,
                  text: doc.getText(),
                  fileName: doc.fileName
                });
              }
              break;

            case "optimize":
              {
                const { code, backendUrl } = message;
                panel.webview.postMessage({ kind: "status", text: "Sending to backend..." });

                try {
                  // call backend
                  // Expect backend returns JSON { optimized_code, suggestions, metrics }
                  const url = backendUrl || "http://localhost:8000/optimize";
                  // Use global fetch (Node 18+) — if unavailable, your environment must supply a polyfill
                  const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ language: "c", code })
                  });

                  if (!res.ok) {
                    const txt = await res.text();
                    panel.webview.postMessage({ kind: "error", text: `Backend error: ${res.status} ${txt}` });
                    return;
                  }

                  const data = await res.json();
                  panel.webview.postMessage({ kind: "result", data });
                } catch (err: any) {
                  panel.webview.postMessage({ kind: "error", text: String(err) });
                }
              }
              break;

            case "applyOptimized":
              {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                  vscode.window.showErrorMessage("No active editor to apply optimized code.");
                  return;
                }
                const optimized = message.optimized;
                const fullRange = new vscode.Range(
                  editor.document.positionAt(0),
                  editor.document.positionAt(editor.document.getText().length)
                );
                await editor.edit((editBuilder) => {
                  editBuilder.replace(fullRange, optimized);
                });
                vscode.window.showInformationMessage("Applied optimized code to the active document.");
              }
              break;
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
  // Inline HTML for simplicity
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>LLM C Optimizer</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 10px; }
  textarea { width: 100%; height: 200px; font-family: monospace; font-size: 12px; }
  .row { display:flex; gap:10px; align-items:center; }
  .col { display:flex; flex-direction:column; gap:8px; }
  pre { background:#f5f5f5; padding:10px; overflow:auto; max-height:300px; }
  .log { background:#111; color:#eee; padding:8px; height:80px; overflow:auto; font-size:12px; }
  button{padding:6px 10px}
  .diff { display:flex; gap:10px; }
  .panel { flex:1; }
</style>
</head>
<body>
  <h2>LLM Guided C Optimizer</h2>
  <div>
    Backend URL: <input id="backendUrl" type="text" style="width:60%" placeholder="http://localhost:8000/optimize" />
    <button id="reloadCode">Load from editor</button>
  </div>
  <div class="col" style="margin-top:8px">
    <label>Current code (editable):</label>
    <textarea id="codeArea" placeholder="C code will appear here..."></textarea>
    <div class="row">
      <button id="optBtn">Optimize</button>
      <button id="applyBtn" disabled>Apply optimized code to editor</button>
      <span id="status"></span>
    </div>
  </div>

  <h3>Results</h3>
  <div class="row">
    <div class="panel">
      <h4>Optimized code</h4>
      <pre id="optimizedPre">—</pre>
    </div>
    <div class="panel">
      <h4>Suggestions / Metrics</h4>
      <pre id="metaPre">—</pre>
    </div>
  </div>

  <h3>Diff (old → optimized)</h3>
  <pre id="diffPre">—</pre>

  <h3>Logs</h3>
  <div class="log" id="log"></div>

<script>
  const vscode = acquireVsCodeApi();
  const codeArea = document.getElementById('codeArea');
  const optBtn = document.getElementById('optBtn');
  const reloadCode = document.getElementById('reloadCode');
  const optimizedPre = document.getElementById('optimizedPre');
  const metaPre = document.getElementById('metaPre');
  const status = document.getElementById('status');
  const diffPre = document.getElementById('diffPre');
  const logEl = document.getElementById('log');
  const applyBtn = document.getElementById('applyBtn');
  const backendUrl = document.getElementById('backendUrl');

  function log(msg) { logEl.textContent += '\\n' + msg; logEl.scrollTop = logEl.scrollHeight; }

  // request current code from extension on load
  vscode.postMessage({ command: 'requestCurrentCode' });

  reloadCode.addEventListener('click', () => {
    vscode.postMessage({ command: 'requestCurrentCode' });
  });

  optBtn.addEventListener('click', () => {
    status.textContent = 'Working...';
    log('Optimizing...');
    vscode.postMessage({ command: 'optimize', code: codeArea.value, backendUrl: backendUrl.value });
  });

  applyBtn.addEventListener('click', () => {
    const optimized = optimizedPre.textContent || '';
    vscode.postMessage({ command: 'applyOptimized', optimized });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.kind === 'noEditor') {
      status.textContent = 'Open a C file in the editor and reload.';
      log('No active editor found.');
      return;
    }

    if (msg.kind === 'currentCode') {
      codeArea.value = msg.text || '';
      log('Loaded current editor content.');
      return;
    }

    if (msg.kind === 'status') {
      status.textContent = msg.text;
      log(msg.text);
      return;
    }

    if (msg.kind === 'error') {
      status.textContent = 'Error';
      log('ERROR: ' + msg.text);
      return;
    }

    if (msg.kind === 'result') {
      status.textContent = 'Done';
      const data = msg.data || {};
      const optimized = data.optimized_code || '';
      const suggestions = data.suggestions || [];
      const metrics = data.metrics || {};

      optimizedPre.textContent = optimized || '(no optimized code returned)';
      metaPre.textContent = JSON.stringify({ suggestions, metrics }, null, 2);

      // simple diff: line-based differences
      computeSimpleDiff(codeArea.value, optimized);

      applyBtn.disabled = false;
      log('Received optimized result.');
      return;
    }
  });

  function computeSimpleDiff(orig, opt) {
    const oLines = (orig || '').split('\\n');
    const nLines = (opt || '').split('\\n');
    const max = Math.max(oLines.length, nLines.length);
    const lines = [];
    for (let i=0;i<max;i++) {
      const o = oLines[i] ?? '';
      const n = nLines[i] ?? '';
      if (o === n) {
        lines.push('  ' + o);
      } else {
        if (o) lines.push('- ' + o);
        if (n) lines.push('+ ' + n);
      }
    }
    diffPre.textContent = lines.join('\\n');
  }
</script>
</body>
</html>`;
}
