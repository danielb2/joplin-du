import joplin from 'api';
import { ToolbarButtonLocation } from 'api/types';

joplin.plugins.register({
	onStart: async function() {
		// eslint-disable-next-line no-console
		console.info('Hello world. Test plugin started!');
		const resources = await joplin.data.get(['resources']);
		console.info(resources);
                await registerGetSpace();
		await getSpace();
	},
});

async function registerGetSpace() {

    await joplin.commands.register({
        name: 'createDiskUsageReport',
        label: 'Create Disk Usage Report',
        iconName: 'fas fa-chart-pie',
        execute: async () => {
            // Call the getSpace function when the button is clicked
            await getSpace();
        }
    });

    // Add the button to the toolbar
    await joplin.views.toolbarButtons.create('createDiskUsageReportButton', 'createDiskUsageReport', ToolbarButtonLocation.EditorToolbar);

}

async function getSpace() {
    // Function to convert bytes to MB
    function formatSize(sizeInBytes) {
        return (sizeInBytes / (1024 * 1024)).toFixed(2); // Convert to MB and round to 2 decimal places
    }

    // Fetch all resources (paginated if necessary)
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

    // Now loop through each resource and get its size and linked notes
    let resourceData = {};
    let notebookNames = {}; // Cache notebook names to avoid redundant API calls

    for (let resource of resources) {
        let resourceId = resource.id;
        let resourceSize = resource.size; // Size in bytes
        let resourceTitle = resource.title || 'Untitled'; // Fallback if no title is present

        // Correctly fetch all notes that link to this resource
        let linkedNotes = await joplin.data.get(['resources', resourceId, 'notes'], { fields: ['id', 'title', 'parent_id'] });

        // Process each note that references this resource
        for (let note of linkedNotes.items) {
            let noteId = note.id;
            let noteTitle = note.title || 'Untitled Note';
            let notebookId = note.parent_id; // The notebook containing the note

            // Fetch the notebook name if it's not already cached
            if (!notebookNames[notebookId]) {
                let notebook = await joplin.data.get(['folders', notebookId]);
                notebookNames[notebookId] = notebook.title;
            }

            // Initialize resourceData for this notebook if not already present
            if (!resourceData[notebookId]) {
                resourceData[notebookId] = [];
            }

            // Add the resource data along with its linked note
            resourceData[notebookId].push({
                resourceTitle: resourceTitle,
                resourceSizeMB: formatSize(resourceSize),
                resourceSize: resourceSize, // Keep the original size in bytes for total calculation
                noteTitle: noteTitle,
                noteLink: `[:/${noteId}]`, // Correct format for note link
                noteId: noteId,
                id: resourceId
            });
        }
    }

    // Build the text content for the note
    let noteContent = `# Joplin Disk Usage Report\n\n[toc]\n\n`;

    for (let notebookId in resourceData) {
        let notebookName = notebookNames[notebookId];
        let notebookResources = resourceData[notebookId];

        // Initialize total size for the notebook
        let totalNotebookSize = 0;

        // Calculate total size of the notebook
        for (let resource of notebookResources) {
            totalNotebookSize += resource.resourceSize;
        }

        // Display the total size in the heading
        noteContent += `## 📓 "${notebookName}" (Total size: ${formatSize(totalNotebookSize)} MB)\n\n`;

        let printedResources = new Set(); // To avoid printing the same resource multiple times

        for (let resource of notebookResources) {
            if (!printedResources.has(resource.resourceTitle)) {
                noteContent += `- **Resource**: "${resource.resourceTitle}"\n`;
                noteContent += `  - **Size:** ${resource.resourceSizeMB} MB\n`;
                noteContent += `  - **ID:** ${resource.id}\n`;

                
                // Loop through and print all notes that reference this resource
                for (let note of notebookResources.filter(r => r.resourceTitle === resource.resourceTitle)) {
                    noteContent += `  - 🔗 [${note.noteTitle}](${note.noteLink})\n`;
                }

                printedResources.add(resource.resourceTitle); // Mark this resource as printed
                noteContent += `\n`;
            }
        }
    }

    // Create a new note with the generated content
    await joplin.data.post(['notes'], null, {
        title: 'Joplin Disk Usage Report',
        body: noteContent
    });
}

