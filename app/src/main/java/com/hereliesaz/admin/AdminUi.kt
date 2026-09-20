package com.hereliesaz.admin

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

private val Ink = Color(0xFFF4F0E6)
private val Void = Color(0xFF0A0A0A)
private val Panel = Color(0xFF141414)
private val Danger = Color(0xFF3A1414)
private val DangerInk = Color(0xFFF4B0B0)
private val Good = Color(0xFFB0E0B0)

@Composable fun HereLiesAzAdminTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = Ink, onPrimary = Void, background = Void, onBackground = Ink, surface = Panel, onSurface = Ink, error = DangerInk),
        typography = MaterialTheme.typography.copy(
            bodyLarge = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            bodyMedium = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            labelLarge = MaterialTheme.typography.labelLarge.copy(fontFamily = FontFamily.Monospace),
            titleLarge = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace),
            titleMedium = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Monospace),
        ),
        content = content,
    )
}

@Composable fun AdminApp(vm: AdminViewModel = viewModel()) {
    var confirmDiscard by remember { mutableStateOf(false) }

    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text("Discard staged changes?") },
            text = { Text("This only discards the local draft. Nothing has been submitted to GitHub yet.") },
            confirmButton = {
                DangerButton({
                    confirmDiscard = false
                    vm.discardDraft()
                }) { Text("discard") }
            },
            dismissButton = {
                TextButton({ confirmDiscard = false }) { Text("keep") }
            },
        )
    }

    vm.availableUpdate?.let { update ->
        AlertDialog(
            onDismissRequest = vm::dismissUpdate,
            title = { Text("Update available") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(update.name.ifBlank { update.tag })
                    Text("Installed: " + BuildConfig.VERSION_NAME + "   Available: " + update.version)
                    if (update.notes.isNotBlank()) Text(update.notes.take(900))
                    vm.updateMessage?.let { StatusText(it) }
                }
            },
            confirmButton = {
                Button(onClick = vm::downloadAndInstallUpdate, enabled = !vm.updateBusy) {
                    Text(if (vm.updateBusy) "working…" else "install update")
                }
            },
            dismissButton = {
                TextButton(onClick = vm::dismissUpdate, enabled = !vm.updateBusy) { Text("later") }
            },
        )
    }

    if (!vm.authenticated) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding(), color = Void) {
            TokenScreen(vm, Modifier.padding(16.dp))
        }
        return
    }

    Scaffold(
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        containerColor = Void,
        topBar = {
            Column(Modifier.background(Void)) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AdminTab.entries.forEach { item ->
                        if (vm.tab == item) {
                            Button({ vm.tab = item; if (item == AdminTab.Site) vm.loadSite() }) {
                                Text(if (item == AdminTab.Add) "add art" else item.name.lowercase())
                            }
                        } else {
                            OutlinedButton({ vm.tab = item; if (item == AdminTab.Site) vm.loadSite() }) {
                                Text(if (item == AdminTab.Add) "add art" else item.name.lowercase())
                            }
                        }
                    }
                }

                if (vm.pendingCount > 0) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            vm.pendingCount.toString() + " staged",
                            modifier = Modifier.weight(1f),
                            color = Good,
                        )
                        TextButton(
                            onClick = { confirmDiscard = true },
                            enabled = !vm.submitBusy,
                        ) {
                            Text("discard")
                        }
                        Button(
                            onClick = vm::submitChanges,
                            enabled = !vm.submitBusy,
                        ) {
                            Text(if (vm.submitBusy) "submitting…" else "submit all")
                        }
                    }
                }

                vm.submitMessage?.let {
                    StatusText(it, Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                }
                HorizontalDivider(color = Ink.copy(alpha = 0.18f))
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).padding(horizontal = 12.dp)) {
            when (vm.tab) {
                AdminTab.Art -> PaintingsScreen(vm)
                AdminTab.Dedup -> DedupScreen(vm)
                AdminTab.Add -> AddPaintingScreen(vm)
                AdminTab.Site -> SiteContentScreen(vm)
                AdminTab.Settings -> TokenScreen(vm)
            }
        }
    }
}

@Composable private fun TokenScreen(vm: AdminViewModel, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("GitHub access", style = MaterialTheme.typography.titleLarge)
        Text("Save a gh_token for HereLiesAz/hereliesaz.github.io with Contents: Read and write and Actions: Read and write. It persists on this device encrypted with Android Keystore. The app never borrows GitHub Actions credentials.")
        OutlinedTextField(
            vm.tokenInput,
            { vm.tokenInput = it },
            label = { Text("gh_token") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(vm::verifyAndSaveToken, enabled = vm.tokenInput.isNotBlank() && !vm.busy) {
                Text(if (vm.busy) "checking…" else "save & verify")
            }
            if (vm.authenticated || vm.tokenInput.isNotBlank()) {
                DangerButton(vm::clearToken, !vm.busy) { Text("clear token") }
            }
        }
        vm.authMessage?.let { StatusText(it) }

        HorizontalDivider(color = Ink.copy(alpha = 0.18f))
        Text("App updates", style = MaterialTheme.typography.titleMedium)
        Text("The app automatically checks the latest GitHub Release when it starts.", color = Ink.copy(alpha = 0.65f))
        OutlinedButton(onClick = { vm.checkForUpdates(silent = false) }, enabled = !vm.updateBusy) {
            Text(if (vm.updateBusy) "checking…" else "check for updates")
        }
        vm.updateMessage?.let { StatusText(it) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun PaintingsScreen(vm: AdminViewModel) {
    vm.selectedArtwork?.let {
        PaintingEditorScreen(vm, it)
        return
    }

    var confirmBulkRemove by remember { mutableStateOf(false) }
    if (confirmBulkRemove) {
        val count = vm.selectedArtworkIds.size
        AlertDialog(
            onDismissRequest = { confirmBulkRemove = false },
            title = { Text("Stage $count for deletion?") },
            text = {
                Text(
                    "These photos will be queued for deletion. Nothing is deleted until you tap Submit All.",
                )
            },
            confirmButton = {
                DangerButton({
                    confirmBulkRemove = false
                    vm.stageSelectedForRemoval()
                }) {
                    Text("stage deletion")
                }
            },
            dismissButton = {
                TextButton({ confirmBulkRemove = false }) { Text("cancel") }
            },
        )
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Art (" + (vm.paintings?.size?.toString() ?: "…") + ")",
                style = MaterialTheme.typography.titleLarge,
            )
            OutlinedButton(
                vm::refreshPaintings,
                enabled = vm.paintings != null && !vm.multiSelectionActive,
            ) {
                Text(if (vm.paintings == null) "refreshing…" else "refresh")
            }
        }

        if (vm.multiSelectionActive) {
            Row(
                Modifier.fillMaxWidth().background(Panel).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    vm.selectedArtworkIds.size.toString() + " selected",
                    modifier = Modifier.weight(1f),
                    color = Good,
                )
                TextButton(vm::clearArtworkSelection) {
                    Text("clear")
                }
                DangerButton({ confirmBulkRemove = true }) {
                    Text("delete selected")
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        Text(
            if (vm.multiSelectionActive) {
                "Tap photos to add or remove them from the selection."
            } else {
                "Long-press a photo to start multi-selection."
            },
            color = Ink.copy(alpha = 0.65f),
        )

        vm.artMessage?.let {
            Spacer(Modifier.height(6.dp))
            StatusText(it)
        }
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            vm.filter,
            { vm.filter = it },
            label = { Text("filter") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))

        val visible = (vm.paintings ?: emptyList()).filter { item ->
            vm.filter.isBlank() ||
                item.id.contains(vm.filter, true) ||
                item.sourceFilename.orEmpty().contains(vm.filter, true) ||
                vm.meta[item.id]?.title.orEmpty().contains(vm.filter, true)
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(132.dp),
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(visible, key = { it.id }) { item ->
                val selected = item.id in vm.selectedArtworkIds
                Column(
                    Modifier
                        .background(if (selected) Good.copy(alpha = 0.12f) else Panel)
                        .border(
                            width = if (selected) 2.dp else 0.dp,
                            color = if (selected) Good else Color.Transparent,
                        )
                        .combinedClickable(
                            onClick = {
                                if (vm.multiSelectionActive) {
                                    vm.toggleArtworkSelection(item)
                                } else {
                                    vm.selectPainting(item)
                                }
                            },
                            onLongClick = {
                                vm.toggleArtworkSelection(item)
                            },
                        )
                        .padding(6.dp),
                ) {
                    NetworkImage(
                        vm.artworkUrl(item),
                        vm,
                        Modifier.fillMaxWidth().aspectRatio(1f),
                    )
                    Text(vm.meta[item.id]?.title?.ifBlank { item.id } ?: item.id)
                    if (selected) {
                        Text("selected", color = Good)
                    } else {
                        Text(
                            if (item.baked) "live" else "source only",
                            color = if (item.baked) Good else Ink.copy(alpha = 0.5f),
                        )
                    }
                    if (vm.meta[item.id]?.forSale == true) Text("for sale", color = Good)
                }
            }
        }
    }
}

@Composable private fun PaintingEditorScreen(vm: AdminViewModel, item: ArtworkItem) {
    val id = item.id
    var showBands by remember(id) { mutableStateOf(false) }
    var confirmRemove by remember(id) { mutableStateOf(false) }
    val form = vm.paintingForm

    if (confirmRemove) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("Remove $id?") },
            text = { Text("This stages the removal. Nothing will be deleted until you tap Submit All.") },
            confirmButton = {
                DangerButton({ confirmRemove = false; vm.removePainting() }) { Text("remove") }
            },
            dismissButton = { TextButton({ confirmRemove = false }) { Text("cancel") } },
        )
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(id, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            OutlinedButton(vm::closePainting) { Text("close") }
        }

        NetworkImage(vm.artworkUrl(item), vm, Modifier.fillMaxWidth().height(380.dp))
        Text(
            if (item.baked) "live theater bake" else "source photo — not yet in the theater manifest",
            color = if (item.baked) Good else Ink.copy(alpha = 0.6f),
        )

        OutlinedTextField(
            form.title,
            { vm.paintingForm = form.copy(title = it) },
            label = { Text("Title") },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            form.description,
            { vm.paintingForm = form.copy(description = it) },
            label = { Text("Description") },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            form.tags,
            { vm.paintingForm = form.copy(tags = it) },
            label = { Text("Tags (comma-separated)") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(form.forSale, { vm.paintingForm = form.copy(forSale = it) })
            Text("For sale")
        }
        if (form.forSale) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    form.price,
                    { vm.paintingForm = form.copy(price = it) },
                    label = { Text("Price") },
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    form.currency,
                    { vm.paintingForm = form.copy(currency = it) },
                    label = { Text("Currency") },
                    modifier = Modifier.width(120.dp),
                )
            }
        }

        Text("Depth layers", style = MaterialTheme.typography.titleMedium)
        if (item.baked) {
            OutlinedButton({
                showBands = !showBands
                if (showBands) vm.loadBands()
            }) {
                Text(if (showBands) "hide layer editor" else "edit layers")
            }
            if (showBands) BandEditor(vm, id)
        } else {
            Text("No depth layers yet. This source photo becomes editable here after its theater bake is published.", color = Ink.copy(alpha = 0.6f))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(vm::savePainting, enabled = !vm.busy && !vm.removalStaged) {
                Text("stage details")
            }
            DangerButton({ confirmRemove = true }, !vm.busy && !vm.removalStaged) {
                Text(if (vm.removalStaged) "removal staged" else "stage removal")
            }
        }

        vm.editorMessage?.let { StatusText(it) }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable private fun BandEditor(vm: AdminViewModel, id: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (vm.bandLoading) Text("loading layers…")
        vm.theaterMeta?.let {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    NetworkImage(vm.paintingUrl(id), vm, Modifier.fillMaxWidth().height(220.dp))
                    Text("painting", color = Ink.copy(alpha = 0.6f))
                }
                Column(Modifier.weight(1f)) {
                    vm.depthUrl()?.let { url ->
                        NetworkImage(url, vm, Modifier.fillMaxWidth().height(220.dp))
                    }
                    Text("depth map", color = Ink.copy(alpha = 0.6f))
                }
            }
            Text(
                "Each tile is one depth layer, darkest/farthest first. Hidden layers fold into a visible neighbor instead of leaving a gap.",
                color = Ink.copy(alpha = 0.65f),
            )
        }

        vm.bandPreviews.chunked(2).forEach { bandRow ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                bandRow.forEach { band ->
                    Column(
                        Modifier.weight(1f).background(Panel).clickable { vm.toggleBand(band.index) }.padding(5.dp),
                    ) {
                        Image(
                            band.bitmap.asImageBitmap(),
                            "layer " + band.index,
                            Modifier.fillMaxWidth(),
                            contentScale = ContentScale.Fit,
                            alpha = if (band.hidden) 0.35f else 1f,
                        )
                        Text("layer " + band.index + if (band.hidden) " — hidden" else "")
                    }
                }
                if (bandRow.size == 1) Spacer(Modifier.weight(1f))
            }
        }

        if (vm.bandPreviews.isNotEmpty()) {
            Button(vm::saveBands, enabled = !vm.busy && vm.bandHidden.size < vm.bandPreviews.size) {
                Text("stage layers")
            }
        }
        vm.bandMessage?.let { StatusText(it) }
    }
}

private enum class DedupFilter {
    All,
    Duplicates,
    Similar,
}

@Composable private fun DedupScreen(vm: AdminViewModel) {
    var filter by remember { mutableStateOf(DedupFilter.All) }
    val report = vm.dedupReport

    Column(
        Modifier.fillMaxSize().padding(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Dedup", style = MaterialTheme.typography.titleLarge)
            OutlinedButton(
                onClick = vm::scanForDuplicates,
                enabled = !vm.dedupBusy,
            ) {
                Text(if (vm.dedupBusy) "scanning…" else if (report == null) "scan" else "rescan")
            }
        }

        Text(
            "Exact copies, compressed/resized copies, and visually similar images. " +
                "Nothing is deleted here; deletions are only staged for Submit All.",
            color = Ink.copy(alpha = 0.65f),
        )

        vm.dedupMessage?.let { StatusText(it) }

        if (report == null) {
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = vm::scanForDuplicates,
                enabled = !vm.dedupBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (vm.dedupBusy) "scanning photo library…" else "scan for duplicates")
            }
            return
        }

        Text(
            report.imageCount.toString() + " images · " +
                report.exactCount + " exact · " +
                report.compressedCount + " compressed copies · " +
                report.similarCount + " similar pairs",
            color = Good,
        )

        if (report.scanErrorCount > 0) {
            Text(
                report.scanErrorCount.toString() + " image(s) could not be visually decoded; exact file matching still ran where possible.",
                color = DangerInk,
            )
        }

        if (report.exactCount + report.compressedCount > 0) {
            Button(
                onClick = vm::stageAllSuggestedDuplicates,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("stage all duplicate suggestions")
            }
        }

        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            DedupFilter.entries.forEach { option ->
                FilterChip(
                    selected = filter == option,
                    onClick = { filter = option },
                    label = {
                        Text(
                            when (option) {
                                DedupFilter.All -> "all"
                                DedupFilter.Duplicates -> "duplicates"
                                DedupFilter.Similar -> "similar"
                            },
                        )
                    },
                )
            }
        }

        val visiblePairs = report.pairs.filter { pair ->
            when (filter) {
                DedupFilter.All -> true
                DedupFilter.Duplicates ->
                    pair.kind == DedupKind.Exact || pair.kind == DedupKind.Compressed
                DedupFilter.Similar -> pair.kind == DedupKind.Similar
            }
        }

        if (visiblePairs.isEmpty()) {
            Text("No matches in this view.", color = Ink.copy(alpha = 0.6f))
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                itemsIndexed(
                    items = visiblePairs,
                    key = { index, pair ->
                        pair.left.id + "::" + pair.right.id + "::" + index
                    },
                ) { _, pair ->
                    DedupPairCard(vm, pair)
                }
            }
        }
    }
}

@Composable private fun DedupPairCard(vm: AdminViewModel, pair: DedupPair) {
    val kindLabel = when (pair.kind) {
        DedupKind.Exact -> "exact duplicate"
        DedupKind.Compressed -> "compressed / resized copy"
        DedupKind.Similar -> "similar"
    }
    val certainty = String.format(java.util.Locale.US, "%.1f%%", pair.certainty)
    val suggestedRemove = pair.suggestedRemoveId

    Column(
        Modifier.fillMaxWidth().background(Panel).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(kindLabel, style = MaterialTheme.typography.titleMedium)
            Text("certainty " + certainty, color = Good)
        }

        if (pair.reasons.isNotEmpty()) {
            Text(pair.reasons.joinToString(" · "), color = Ink.copy(alpha = 0.62f))
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DedupImageCard(vm, pair.left, pair, Modifier.weight(1f))
            DedupImageCard(vm, pair.right, pair, Modifier.weight(1f))
        }

        if (suggestedRemove != null && suggestedRemove !in vm.draft.removals) {
            val image = if (pair.left.id == suggestedRemove) pair.left else pair.right
            OutlinedButton(
                onClick = { vm.stageDedupRemoval(image) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("queue suggested removal")
            }
        }
    }
}

@Composable private fun DedupImageCard(
    vm: AdminViewModel,
    image: DedupImage,
    pair: DedupPair,
    modifier: Modifier = Modifier,
) {
    val queued = image.id in vm.draft.removals
    val keep = pair.suggestedKeepId == image.id
    val remove = pair.suggestedRemoveId == image.id

    Column(
        modifier.background(Void).padding(5.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        NetworkImage(
            vm.dedupImageUrl(image),
            vm,
            Modifier.fillMaxWidth().aspectRatio(1f),
        )
        Text(image.id, maxLines = 2)

        val dimensions =
            if (image.width != null && image.height != null) {
                image.width.toString() + "×" + image.height
            } else {
                "dimensions unknown"
            }
        Text(
            dimensions + " · " + formatBytes(image.bytes),
            color = Ink.copy(alpha = 0.6f),
        )

        when {
            queued -> Text("queued for deletion", color = DangerInk)
            keep -> Text("suggested keep", color = Good)
            remove -> Text("suggested remove", color = DangerInk)
        }

        DangerButton(
            onClick = { vm.stageDedupRemoval(image) },
            enabled = !queued,
        ) {
            Text(if (queued) "queued" else "delete")
        }
    }
}

private fun formatBytes(bytes: Long): String =
    when {
        bytes >= 1024L * 1024L ->
            String.format(
                java.util.Locale.US,
                "%.1f MB",
                bytes.toDouble() / (1024.0 * 1024.0),
            )
        bytes >= 1024L ->
            String.format(
                java.util.Locale.US,
                "%.0f KB",
                bytes.toDouble() / 1024.0,
            )
        else -> bytes.toString() + " B"
    }

@Composable private fun AddPaintingScreen(vm: AdminViewModel) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        vm.chooseUris(uris)
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add art", style = MaterialTheme.typography.titleLarge)
        Text("Pick one or more artwork images. They stay on this device until you tap Submit All.")
        OutlinedButton({ launcher.launch(arrayOf("image/*")) }, enabled = !vm.busy) { Text("choose photos") }
        Text(vm.chosenUris.size.toString() + " selected")
        Button(
            { vm.uploadChosen(context.contentResolver) },
            enabled = vm.chosenUris.isNotEmpty() && !vm.busy,
        ) {
            Text(if (vm.busy) "working…" else "stage " + vm.chosenUris.size)
        }
        if (vm.draft.uploads.isNotEmpty()) {
            Text(vm.draft.uploads.size.toString() + " photo(s) staged in this draft.", color = Good)
        }
        vm.addMessage?.let { StatusText(it) }
    }
}

@Composable private fun SiteContentScreen(vm: AdminViewModel) {
    LaunchedEffect(Unit) { vm.loadSite() }
    val content = vm.siteContent ?: run {
        Text("loading…", modifier = Modifier.padding(vertical = 12.dp))
        return
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Site", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(
            content.about,
            { vm.setSite(content.copy(about = it)) },
            label = { Text("About text") },
            minLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("Menu links", style = MaterialTheme.typography.titleMedium)

        content.menuLinks.forEachIndexed { index, link ->
            Column(Modifier.fillMaxWidth().background(Panel).padding(8.dp)) {
                OutlinedTextField(
                    link.label,
                    { value ->
                        val links = content.menuLinks.toMutableList()
                        links[index] = link.copy(label = value)
                        vm.setSite(content.copy(menuLinks = links))
                    },
                    label = { Text("label") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    link.href,
                    { value ->
                        val links = content.menuLinks.toMutableList()
                        links[index] = link.copy(href = value)
                        vm.setSite(content.copy(menuLinks = links))
                    },
                    label = { Text("href") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        link.external,
                        { value ->
                            val links = content.menuLinks.toMutableList()
                            links[index] = link.copy(external = value)
                            vm.setSite(content.copy(menuLinks = links))
                        },
                    )
                    Text("new tab")
                    Spacer(Modifier.weight(1f))
                    DangerButton({
                        vm.setSite(
                            content.copy(
                                menuLinks = content.menuLinks.filterIndexed { i, _ -> i != index },
                            ),
                        )
                    }) { Text("remove") }
                }
            }
        }

        OutlinedButton({
            vm.setSite(content.copy(menuLinks = content.menuLinks + MenuLink()))
        }) { Text("+ add link") }

        Button(vm::saveSite, enabled = !vm.busy) {
            Text("stage site")
        }
        vm.siteMessage?.let { StatusText(it) }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable private fun NetworkImage(url: String, vm: AdminViewModel, modifier: Modifier = Modifier) {
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = runCatching { vm.bitmap(url) }.getOrNull()
    }
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        bitmap?.let {
            Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        } ?: Text("…", color = Ink.copy(alpha = 0.4f))
    }
}

@Composable private fun DangerButton(onClick: () -> Unit, enabled: Boolean = true, content: @Composable () -> Unit) {
    Button(
        onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = DangerInk),
        content = { content() },
    )
}

@Composable private fun StatusText(message: String, modifier: Modifier = Modifier) {
    val loadedCleanly =
        message.startsWith("Loaded") && !message.contains("Could not", ignoreCase = true)
    val good =
        message.startsWith("Verified") ||
        message.startsWith("Staged") ||
        message.startsWith("Submitted") ||
        message.startsWith("Discarded") ||
        loadedCleanly
    Text(message, modifier = modifier, color = if (good) Good else Ink.copy(alpha = 0.78f))
}

@Composable private fun OpenLinkButton(label: String, url: String) {
    val context = LocalContext.current
    OutlinedButton({ context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) { Text(label) }
}
