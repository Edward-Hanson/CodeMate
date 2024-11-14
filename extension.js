const vscode = require('vscode');

/**
 * Activates the extension.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const generateTestForFunction = vscode.commands.registerCommand(
        "extension.generateTestForFunction",
        (functionRange) => generateUnitTestForFunction(functionRange) // Runs only when clicked
    );
    context.subscriptions.push(generateTestForFunction);

    // Update decorations when the active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            updateDecorations(editor);
        }
    });

    // Update decorations when the text document changes
    vscode.workspace.onDidChangeTextDocument(event => {
        if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
            updateDecorations(vscode.window.activeTextEditor);
        }
    });

    /**
     * Updates the decorations in the editor.
     * @param {vscode.TextEditor} editor
     */
    function updateDecorations(editor) {
        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: "🧪Generate Test",
                color: "lightgray",
                fontWeight: "bold",
                margin: "0 0 0 1rem",
            }
        });

        const functionRanges = getFunctionRanges(editor.document);

        const decorations = functionRanges.map(range => ({
            range: new vscode.Range(range.start.line, range.start.character, range.start.line, range.end.character),
            renderOptions: {
                after: { contentText: "🧪Generate Test" },
            },
            hoverMessage: "Click to generate unit test",
            command: {
                command: "extension.generateTestForFunction",
                title: "Generate Test",
                arguments: [range] // Pass range to the command
            }
        }));

        editor.setDecorations(decorationType, decorations);
    }

   
    function getFunctionRanges(document) {
        const functionRanges = [];
        const functionRegex = /function\s+(\w+)\s*\(.*\)\s*{/g;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const match = functionRegex.exec(line.text);
            if (match) {
                const start = new vscode.Position(i, 0);
                const end = line.range.end;
                functionRanges.push(new vscode.Range(start, end));
            }
        }
        return functionRanges;
    }

  
    async function generateUnitTestForFunction(functionRange) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage("No active editor found.");
            return;
        }

        const code = editor.document.getText(functionRange);
        const testCode = await generateTest(code);
        showGeneratedTest(testCode);
    }

   
    async function generateTest(code) {
        const prompt = `Write a simple functional unit test for the function below: \n ${code}`;
        const apiUrl = "https://ai-api.amalitech.org/api/v1";

        try {
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": "ClZiz5iYXFNKPxoX0o0MEg6jiZJlJsF9"
                },
                body: JSON.stringify({ prompt, stream: false })
            });

            if (!response.ok) {
                throw new Error("API request failed");
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error("Error generating test:", error);
            return "There was an error generating the test.";
        }
    }

    /**
     * Shows the generated test code in a new editor tab.
     */
    function showGeneratedTest(testCode) {
        vscode.workspace.openTextDocument({ content: testCode, language: 'javascript' })
            .then(doc => vscode.window.showTextDocument(doc));
    }
}

/**
 * Deactivates the extension.
 */
function deactivate() {}

module.exports = {
    activate,
    deactivate
};
