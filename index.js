const { askQuestion } = require('./utils/misc')
const config = require('./config.json')
const { KokoCtx } = require('./utils/koko')
const fs = require('fs')
const { VichanCtx } = require('./utils/vichan')

/**
 * Program entrypoint
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function main(args) {
	if (!args.includes('--confirm')) {
		const shouldContinue = (await askQuestion(
			'This script will read from a Kokonotsuba database and migrate its posts into an *existing* vichan database.\n' +
			'You should back up your vichan database before doing this!\n' +
			'You must also copy "config.example.json" as "config.json" and edit it if you haven\'t already.\n'+
			'You can skip this message and confirmation in the future by passing --confirm as an argument.\n' +
			'To copy only media from boards, specify --files-only. This option does not support resuming.\n' +
			'Are you sure you want to continue? [y/N] '
		)).toLowerCase() === 'y'

		if(!shouldContinue)
			return
	}

	if (args.includes('--files-only')) {
		console.log('Option --files-only specified, files from boards will be copied in bulk, and no post migration will be done')

		// Iterate over boards and copy their files
		const boardMappings = config.kokoToVichanBoardMappings
		const kokoBoards = Object.keys(boardMappings)
		const kokoThumbPattern = /s\.(\w+)$/
		for (const kokoBoard of kokoBoards) {
			const vichanBoard = boardMappings[kokoBoard]

			const kokoResDir = `${config.koko.basePath}/${kokoBoard}/src`

			const vichanSrcDir = `${config.vichan.instancePath}/${vichanBoard}/src`
			const vichanThumbDir = `${config.vichan.instancePath}/${vichanBoard}/thumb`

			// List files in res dir
			let count = 0
			for (const kokoFileName of fs.readdirSync(kokoResDir)) {
				const kokoFilePath = kokoResDir + '/' + kokoFileName

				let vichanTarget
				if (kokoThumbPattern.test(kokoFileName)) {
					// File is a thumbnail
					vichanTarget = vichanThumbDir + '/' + kokoFileName.replace(kokoThumbPattern, '.$1')
				} else {
					// File is a normal image
					vichanTarget = vichanSrcDir + '/' + kokoFileName
				}

				if (fs.existsSync(vichanTarget)) {
					console.log(`Skipping already copied file from ${kokoFilePath} to ${vichanTarget}`)
				} else if(fs.statSync(kokoFilePath).isFile()) {
					console.log(`Copying ${kokoFilePath} to ${vichanTarget}...`)
					fs.copyFileSync(kokoFilePath, vichanTarget)
				} else {
					console.log(`Skipping non-file path ${kokoFilePath}`)
				}

				count++
			}

			console.log(`Successfully copied ${count} files from koko board ${kokoBoard} to vichan board ${vichanBoard}`)
		}

		return
	}

	// Set up progress
	/**
	 * Progress. Keys are koko boards.
	 * @type {{ [key: string]: { completed: boolean, postNo: number, threadMappings: { [key: number]: number } } }}
	 */
	let progress = {}
	function writeProgress() {
		fs.writeFileSync('./progress.json', JSON.stringify(progress))
	}
	if (fs.existsSync('./progress.json')) {
		console.log('Found progress.json, resuming using its contents')
		console.log('If you want to start over from the beginning, deleted the file and restart the program')
		progress = JSON.parse(fs.readFileSync('./progress.json').toString())
	} else {
		writeProgress()
	}

	// Iterate over boards and migrate them
	const boardMappings = config.kokoToVichanBoardMappings
	const kokoBoards = Object.keys(boardMappings)

	for (const kokoBoard of kokoBoards) {
		const vichanBoard = boardMappings[kokoBoard]

		let boardProg = progress[kokoBoard]

		// Create progress entry if none exists for board
		if (boardProg == null) {
			progress[kokoBoard] = { completed: false, postNo: 0, threadMappings: {} }
			boardProg = progress[kokoBoard]
			writeProgress()
		}

		// Skip or resume based on progress entry data
		if (boardProg.completed) {
			console.log(`Skipping already migrated koko board ${kokoBoard}`)
			continue
		} else if (boardProg.postNo > 0) {
			console.log(`Resuming migration of koko board ${kokoBoard} from post no. ${boardProg.postNo}...`)
		} else {
			console.log(`Beginning migration of koko board ${kokoBoard}...`)
		}

		const kokoCtx = new KokoCtx(kokoBoard)
		const vichanCtx = new VichanCtx(vichanBoard, boardProg.threadMappings)

		try {
			await kokoCtx.testConn()
		} catch(err) {
			console.error('Failed to connect to koko database')
			throw err
		}
		try {
			await vichanCtx.testConn()
		} catch(err) {
			console.error('Failed to connect to vichan database')
			throw err
		}

		// Iterate over rows and migrate them
		let lastCount = null
		while (lastCount === null || lastCount >= config.rowsPerIteration) {
			const rows = await kokoCtx.fetchRows(boardProg.postNo, config.rowsPerIteration)
			lastCount = rows.length

			if (rows.length > 0) {
				// Copy images
				for (const row of rows) {
					row.thumbExt = 'png'

					// Row has image
					if (row.md5chksum) {
						const imgPath = `${config.koko.basePath}/${kokoBoard}/src/${row.tim}${row.ext}`
						const imgTarget = `${config.vichan.instancePath}/${vichanBoard}/src/${row.tim}${row.ext}`

						if (fs.existsSync(imgPath))
							fs.copyFileSync(imgPath, imgTarget)
						else
							console.warn(`Could not find image file at ${imgPath}, so it was not copied`)

						// Try exotic thumbnails first
						const thumbExts = ['gif', 'jpg', 'jpeg', 'jfif', 'png']
						let matchedExt = false
						for (const ext of thumbExts) {
							const src = `${config.koko.basePath}/${kokoBoard}/src/${row.tim}s.${ext}`
							const target = `${config.vichan.instancePath}/${vichanBoard}/thumb/${row.tim}.${ext}`

							if (fs.existsSync(src)) {
								fs.copyFileSync(src, target)
								matchedExt = true
							}
						}

						if (!matchedExt)
							console.warn(`Could not find image thumbnail for post no. ${row.no}, so it was not copied (try running with --files-only to force-copy everything)`)
					}
				}

				// Migrate posts
				await vichanCtx.insertRowsFromKoko(rows)

				console.log(`Migrated post no. ${rows[0].no}-${rows[rows.length - 1].no}...`)
			}

			// Write progress
			boardProg.postNo = rows[rows.length - 1]?.no || 0
			writeProgress()
		}

		boardProg.completed = true
		writeProgress()
		console.log(`Successfully migrated posts from koko board ${kokoBoard} to vichan board ${vichanBoard}`)

		await kokoCtx.close()
		await vichanCtx.close()
	}

	console.log('All board migrations are complete')
}

main(process.argv.slice(2))
	.catch(console.error)
	.finally(() => process.exit())