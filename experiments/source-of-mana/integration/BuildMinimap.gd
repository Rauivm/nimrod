extends SceneTree

# Build-time overview from the same collision cells as the actual Tiled map.
func _initialize():
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.size() != 2:
		quit(1)
		return
	var plan = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	# The existing Tiled importer accepts PNG/JPG, so rasterize our source SVG here.
	var board := Image.new()
	var artwork: String = args[0].get_base_dir().path_join("../../graphics/tilesets/nimrod")
	if board.load_svg_from_string(FileAccess.get_file_as_string(artwork.path_join("noticeboard.svg"))) != OK:
		quit(1)
		return
	if board.save_png(artwork.path_join("noticeboard.png")) != OK:
		quit(1)
		return
	var overview: Image = Image.create(int(plan.width) * 8, int(plan.height) * 8, false, Image.FORMAT_RGBA8)
	for y in int(plan.height):
		for x in int(plan.width):
			var color: Color = Color("4b4333") if plan.collision[y * int(plan.width) + x] else Color("baa06a")
			for dy in 8:
				for dx in 8:
					overview.set_pixel(x * 8 + dx, y * 8 + dy, color)
	DirAccess.make_dir_recursive_absolute(args[1].get_base_dir())
	quit(0 if overview.save_png(args[1]) == OK else 1)
