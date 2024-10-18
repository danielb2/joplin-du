import joplin from 'api';
import { ToolbarButtonLocation, SettingItemType } from 'api/types';

joplin.plugins.register({
    onStart: async function() {
        const resources = await joplin.data.get(['resources']);
        await settings();
        await registerTrash();
        await registerGetSpace();
    },
});

async function settings() {
    await joplin.settings.registerSection('myPluginSettings', {
        label: 'Disk Usage Settings',
        iconName: 'fas fa-cog',
    });

    await joplin.settings.registerSettings({
        showDeleteButton: {
            type: SettingItemType.Bool,
            value: true, // Default value
            public: true,
            section: 'myPluginSettings',
            label: 'Show Delete Button',
            description: 'Toggle whether to show the Send to Trash button in the editor toolbar.',
        }
    });
}

async function refreshNoteList() {
    const note = await joplin.workspace.selectedNote();
    const allNotebooks = await joplin.data.get(['folders'], { fields: ['id'] });
    const currentNotebookId = note.parent_id; // Assuming parent_id is the current notebook
    const otherNotebookId = allNotebooks.items.find(folder => folder.id !== currentNotebookId).id;

    // Switch to another notebook and back to refresh
    await joplin.commands.execute('openFolder', otherNotebookId);
    await joplin.commands.execute('openFolder', currentNotebookId);
}

async function registerTrash() {

    const show = await joplin.settings.value('showDeleteButton');
    if (!show) { return; }

    await joplin.commands.register({
        name: 'sendCurrentNoteToTrash',
        label: 'Send Current Note to Trash',
        iconName: 'fas fa-trash',
        execute: async () => {
            const note = await joplin.workspace.selectedNote();
            if (note) {
                // Move the note to the trash by setting is_conflict to 1
                await joplin.data.delete(['notes', note.id]);
                await joplin.commands.execute('focusElementNoteList');
                await joplin.commands.execute('editor.focus');  // Focus back on the editor
            } else {
                console.warn('No note is currently selected.');
            }
        }
    });

    // Create a toolbar button with a trash bin icon
    await joplin.views.toolbarButtons.create(
        'sendToTrashButton',            // Unique button ID
        'sendCurrentNoteToTrash',       // Command to execute
        ToolbarButtonLocation.EditorToolbar,  // Location of the button
    );
}


async function registerGetSpace() {

    await joplin.commands.register({
        name: 'createDiskUsageReport',
        label: 'Create Disk Usage Report',
        iconName: 'fas fa-chart-pie',
        execute: async () => {
            await getSpace();
        }
    });

    // Add the button to the toolbar
    await joplin.views.toolbarButtons.create('createDiskUsageReportButton', 'createDiskUsageReport', ToolbarButtonLocation.EditorToolbar);

}

async function createTempNote() {
    const currentFolder = await joplin.workspace.selectedFolder();

    const newNote = await joplin.data.post(['notes'], null, {
        title: 'Joplin Disk Usage Report',
        parent_id: currentFolder.id,
        body: 'Wait ... processing'
    });
    await joplin.commands.execute('openNote', newNote.id);
    return newNote;
}

async function getSpace() {
    function formatSize(sizeInBytes) {
        return (sizeInBytes / (1024 * 1024)).toFixed(2); // Convert to MB and round to 2 decimal places
    }

    const tmpNote = await createTempNote();

    let page = 1;
    let resources = [];
    let pageSize = 100;
    let response;

    do {
        response = await joplin.data.get(['resources'], {
            fields: ['id', 'size', 'title'], // Fetch size and title explicitly
            page: page,
            limit: pageSize
        });
        resources = resources.concat(response.items);
        page++;
    } while (response.has_more);

    let resourceData = {};
    let notebookNames = {};
    let notebookSizes = {}; // Keep track of total sizes for sorting

    for (let resource of resources) {
        let resourceId = resource.id;
        let resourceSize = resource.size;
        let resourceTitle = resource.title || 'Untitled';

        let linkedNotes = await joplin.data.get(['resources', resourceId, 'notes'], { fields: ['id', 'title', 'parent_id'] });

        for (let note of linkedNotes.items) {
            let noteId = note.id;
            let noteTitle = note.title || 'Untitled Note';
            let notebookId = note.parent_id;

            if (!notebookNames[notebookId]) {
                let notebook = await joplin.data.get(['folders', notebookId]);
                notebookNames[notebookId] = notebook.title;
            }

            if (!resourceData[notebookId]) {
                resourceData[notebookId] = [];
            }

            resourceData[notebookId].push({
                resourceTitle: resourceTitle,
                resourceSizeMB: formatSize(resourceSize),
                resourceSize: resourceSize,
                noteTitle: noteTitle,
                noteLink: `:/${noteId}`,
                noteId: noteId,
                id: resourceId
            });

            // Track total size of each notebook
            if (!notebookSizes[notebookId]) {
                notebookSizes[notebookId] = 0;
            }
            notebookSizes[notebookId] += resourceSize;
        }
    }

    // Convert notebookSizes object into an array and sort by size
    let sortedNotebooks = Object.keys(notebookSizes)
    .map(notebookId => ({ id: notebookId, size: notebookSizes[notebookId] }))
    .sort((a, b) => b.size - a.size);

    let noteContent = `# Joplin Disk Usage Report\n\n[toc]\n\n`;

    for (let notebook of sortedNotebooks) {
        let notebookId = notebook.id;
        let notebookName = notebookNames[notebookId];
        let notebookResources = resourceData[notebookId];
        notebookResources.sort((a, b) => b.resourceSize - a.resourceSize);

        let totalNotebookSize = notebook.size;

        noteContent += `## 📓 "${notebookName}" (Total size: ${formatSize(totalNotebookSize)} MB)\n\n`;

        let printedResources = new Set();

        for (let resource of notebookResources) {
            if (!printedResources.has(resource.resourceTitle)) {
                noteContent += `- **Resource**: "${resource.resourceTitle}"\n`;
                noteContent += `  - **Size:** ${resource.resourceSizeMB} MB\n`;
                noteContent += `  - **ID:** ${resource.id}\n`;

                for (let note of notebookResources.filter(r => r.id === resource.id)) {
                    noteContent += `  - [${note.noteTitle}](${note.noteLink})\n`;
                }

                printedResources.add(resource.resourceTitle);
                noteContent += `\n`;
            }
        }
    }

    const currentFolder = await joplin.workspace.selectedFolder();
    const newNote = await joplin.data.post(['notes'], null, {
        title: 'Joplin Disk Usage Report',
        parent_id: currentFolder.id,
        body: noteContent
    });
    await joplin.commands.execute('openNote', newNote.id);
    console.info(tmpNote);
    await joplin.data.delete(['notes', tmpNote.id]);
}

