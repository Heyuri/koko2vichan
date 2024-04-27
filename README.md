# koko2vichan
Migrate Kokonotsuba posts to board(s) on an existing vichan instance

## Install
You need Node.js 16+ installed first.
Once you have that, run `npm install` in the project directory.

## Usage
First, copy `config.example.json` to `config.json` and edit it with your details.
The field `kokoToVichanBoardMappings` is mappings from the source koko boards to migrate to the target vichan boards they will be migrated to.
So if I wanted to migration /a/ on koko to /anime/ on vichan, it would look like this:

```json
"kokoToVichanBoardMappings": {
    "a": "anime"
}
```

Run `node index.js` to start the script.

To only copy over board files, specify the `--files-only` option.

## Troubleshooting
### Posts imported, but thumbnails are broken
Try running with `--files-only` after migrating.