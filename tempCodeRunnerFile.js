function createDecorations() {
    return Array.from(state.functionRanges.entries()).map(([name, range]) => ({
        range: new vscode.Range(
            range.end.line,
            range.end.character - 1,
            range.end.line,
            range.end.character + 6
        ),
        hoverMessage: `Click to generate test for function "${name}"`,
        renderOptions: {
            after: {
                contentText: '⚡Test',
                margin: '0 0 0 1rem',
                textDecoration: 'none; cursor: pointer !important;'
            }
        }
    }));
}