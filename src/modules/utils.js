const vscode = require('vscode');


function isValidSourceFile(document) {
    return (document.languageId === 'javascript' || document.languageId === 'typescript') && !document.fileName.includes('.test.');
}

/**
 * Detect functions in the document and add placeholders
 * @param {vscode.TextDocument} document 
 */
function detectFunctions(state, document) {
    state.functionRanges.clear();

    const edits = [];
    const placeholder = " ".repeat(50); // Example placeholder: 10 spaces

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const trimmedLine = line.text.trim();

        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
            continue;
        }

        const match = findFunctionDefinition(line.text);
        if (match) {
            const range = new vscode.Range(i, 0, i, line.text.trim().length);
            state.functionRanges.set(match.name, range);

            // Check if there's enough whitespace at the end of the line
            if (!line.text.endsWith(placeholder)) {
                const edit = vscode.TextEdit.insert(
                    new vscode.Position(i, line.text.length),
                    placeholder
                );
                edits.push(edit);
            }
        }
    }

    if (edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        vscode.workspace.applyEdit(workspaceEdit);
    }
}


/**
 * Find function definition in a line of code
 * @param {string} text 
 */
function findFunctionDefinition(text) {

    const patterns = [
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        /^(?:export\s+)?const\s+(\w+)\s*=\s*function\s*\(/,
        /^(?:export\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/
    ];

    // Remove patterns that match inside comments
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Additional check to ensure it's not inside a comment
            const commentIndex = text.indexOf('//');
            if (commentIndex === -1 || match.index < commentIndex) {
                return { name: match[1] };
            }
        }
    }
    return null;
}



/**
 * Create decorations array for detected functions
 */
function createDecorations(state) {
    return Array.from(state.functionRanges.entries()).map(([name, range]) => ({
        range: new vscode.Range(
            range.end.line,
            range.end.character + 4,
            range.end.line,
            range.end.character +5
        ),
        hoverMessage: `Click to generate test for function "${name}"`,
        renderOptions: {
            after: {
                contentText: '⚡Test',
                margin: '0 0rem 0 0rem',
                padding: '0 0rem 0 0rem',
                textDecoration: 'none; cursor: pointer !important;'
            }
        }
    }));
}

module.exports = { isValidSourceFile, detectFunctions, createDecorations };
