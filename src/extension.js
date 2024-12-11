
const vscode = require('vscode');
const path = require('path');
const { analyzeComplexity, showComplexityDashboard, highlightComplexFunctions } = require('./modules/complexityAnalysis.js');
const { handleBatchTestGeneration, handleTestGeneration } = require('./modules/testGeneration.js');
const { handleFunctionRefactoring , extractFunctionCode} = require('./modules/refactoring.js');
const { isValidSourceFile} = require('./modules/utils.js');


/**
 * Extension state management for CodeMate
 */
const state = {
    activeEditor: null,
    decorationType: null,
    refactorDecorationType: null ,
    batchDecorationType: null,
    functionRanges: new Map(),
    complexityRanges: new Map(),
    lastProcessedVersion: undefined,
    isEditingFunction: false,
    lastClickTime: 0,
    batchStatusBarItem: null,
    lastTypingTime: 0,
    editingTimeout: null,
};

/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context 
 */
function activate(context) {

    state.decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: '⚡Test',
            color: new vscode.ThemeColor('editorLink.activeForeground'),
            margin: '0 0 0 1rem',
            fontWeight: 'normal',
            backgroundColor: 'transparent',
            textDecoration: 'none; cursor: pointer !important;'
        },
        cursor: 'pointer',
        backgroundColor: { id: 'editor.background' },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    state.complexityDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(128,128,128,0.05)', 
    });

    
    state.batchStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        1000  
    );
    state.batchStatusBarItem.text = "$(zap)"; 
    state.batchStatusBarItem.tooltip = "Generate tests for all functions";
    state.batchStatusBarItem.command = 'extension.generateTestsForAllFunctions';
    context.subscriptions.push(state.batchStatusBarItem);

    const repoRoot = path.join(__dirname, '../');

    state.refactorDecorationType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file(path.join(repoRoot + "resources/images/refactor-icon.svg")),
        gutterIconSize: 'contain',
        cursor: 'pointer'
    });



    let showComplexityDisposable = vscode.commands.registerCommand(
        'extension.showComplexityDashboard', ()=> showComplexityDashboard(state)
    );

    // Command registration
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('extension.generateTestForFunction', handleTestGeneration.bind(state,null)),
        vscode.commands.registerTextEditorCommand('extension.generateTestsForAllFunctions',() => handleBatchTestGeneration(state)),
        showComplexityDisposable,
        vscode.commands.registerTextEditorCommand('extension.handleFunctionRefactoring', handleFunctionRefactoring.bind(state, null))
    );
    
    context.subscriptions.push(
                vscode.window.onDidChangeActiveTextEditor(handleEditorChange),
                vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
                vscode.window.onDidChangeTextEditorSelection(handleSelectionChange)
            );
        
    // Event handlers registration
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            if (state.activeEditor) {
                const metrics = analyzeComplexity(state.activeEditor.document);
                highlightComplexFunctions(state, metrics);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (state.activeEditor && event.document === state.activeEditor.document) {
                const metrics = analyzeComplexity(event.document);
                highlightComplexFunctions(state, metrics);
            }
        }),
        vscode.window.onDidChangeTextEditorSelection(() => {
            if (state.activeEditor) {
                const metrics = analyzeComplexity(state.activeEditor.document);
                highlightComplexFunctions(state, metrics);
            }
        })
    );

      const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && isValidSourceFile(activeEditor.document)) {
        state.activeEditor = activeEditor;
        updateDecorations();
        updateBatchButton();
    }
}

/**
 * Handle document changes
 * @param {vscode.TextDocumentChangeEvent} event 
 */
function handleDocumentChange(event) {
    const activeDocument = state.activeEditor?.document;
    if (!activeDocument || event.document !== activeDocument) return;

    state.isEditingFunction = true;
    
    clearTimeout(state.editingTimeout);
    state.editingTimeout = setTimeout(() => {
        state.isEditingFunction = false;
    }, 2000); 

    state.lastProcessedVersion = event.document.version;
    
    const significantChange = event.contentChanges.some(change => 
        !change.text.match(/^\s*\/\//) 
    );

    if (significantChange) {
        updateDecorations();
        updateBatchButton();
    }
}

function handleEditorChange(editor) {
    state.activeEditor = editor;
    if (editor) {
        updateDecorations();
        updateBatchButton();
    }
    else{
        state.batchStatusBarItem.hide();
    }
}



/**
 * Update the batch test button visibility
*/
function updateBatchButton() {
    if (!state.activeEditor) {
        state.batchStatusBarItem.hide();
        return;
    }

    const document = state.activeEditor.document;
    if (!isValidSourceFile(document)) {
        state.batchStatusBarItem.hide();
    }

    if (state.functionRanges.size >= 2) {
        state.batchStatusBarItem.show();
    } else {
        state.batchStatusBarItem.hide();
    }
}


 /**
 * Create decorations array for detected functions
*/
function createDecorations() {
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



/**
 * Handle selection changes for decoration clicks
 * @param {vscode.TextEditorSelectionChangeEvent} event 
 */
function handleSelectionChange(event) {
    if (!state.activeEditor || event.textEditor !== state.activeEditor) {
        return;
    }

    const selection = event.selections[0];
    if (!selection || !selection.isEmpty) {
        return;
    }

    updateDecorations();
    updateBatchButton();
     if (state.activeEditor.document.lineCount > 10) {
        const metrics = analyzeComplexity(state.activeEditor.document);
        highlightComplexFunctions(metrics);
    }

    const position = selection.active;
    const document = state.activeEditor.document;
    const line = document.lineAt(position.line);
    const lineLength = line.text.trim().length;
    const currentTime = Date.now();

    const CLICK_DEBOUNCE_TIME = 2000; 
    const TYPING_COOLDOWN = 2000;

    if (line. text.trim() === '') {
        return;
    }

    if (state.isEditingFunction || 
        (currentTime - (state.lastTypingTime || 0) < TYPING_COOLDOWN)) {
        return;
    }

    // Batch test generation click
    if (line.lineNumber === document.lineCount - 1 && 
        state.functionRanges.size >= 2 &&
        currentTime - state.lastClickTime > CLICK_DEBOUNCE_TIME) {
            console.log("Function Range", state.functionRanges.size);
        const isBatchClick = 
            position.character >= lineLength - 2 && 
            position.character <= lineLength + 1;
        if (isBatchClick && event.selections.length > 1) {
            state.lastClickTime = currentTime;
            handleBatchTestGeneration(state);
            return;
        }
    }

    // Single function test generation click
    const isDeliberateClick =( position.character == lineLength + 5 || position.character == lineLength + 6 ) &&
        currentTime - state.lastClickTime > CLICK_DEBOUNCE_TIME;

    if (isDeliberateClick) {
        state.lastClickTime = currentTime;
        for (const [name, range] of state.functionRanges) {
            if (range.start.line === position.line) {
                const functionInfo = {
                    name,
                    range,
                    code: extractFunctionCode(state, range.start.line)
                };
                handleTestGeneration(state,functionInfo);
                break;
            }
        }
    }
}



/**
  * Update function decorations in the editor
 */
function updateDecorations() {
    if (!state.activeEditor) return;

    const document = state.activeEditor.document;
    if (!isValidSourceFile(document)) {
        state.activeEditor.setDecorations(state.decorationType,[]);
        state.refactorDecorationType.setDecorations(state.decorationType,[]);
        return;
    }

      if (document.lineCount > 10) {
        const metrics = analyzeComplexity(document);
        highlightComplexFunctions(metrics);
    } else {
        state.activeEditor.setDecorations(state.complexityDecorationType, []);
    }

    detectFunctions(document);
    const decorations = createDecorations();
    state.activeEditor.setDecorations(state.decorationType, decorations);
}


/**
 * Detect functions in the document and add placeholders
 * @param {vscode.TextDocument} document 
 */
function detectFunctions(document) {
    state.functionRanges.clear();

    const edits = [];
    const placeholder = " ".repeat(50); 

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
 * Deactivate the extension
 */
function deactivate() {
    if (state.decorationType) state.decorationType.dispose();
    if (state.complexityDecorationType) state.complexityDecorationType.dispose();
    if (state.batchStatusBarItem) state.batchStatusBarItem.dispose();
    state.functionRanges.clear();
}

module.exports = { activate, deactivate };
