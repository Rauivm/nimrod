extends Node

func _ready():
	if not DB.isInitialized:
		await Launcher.dbInitialized
	var hub = preload("res://sources/integration/HubLayout.gd")
	var spawn: Vector2 = hub.Point(hub.Data().spawn)
	assert(hub.Walkable(spawn))
	assert(hub.SafeSpawn(spawn) == spawn)
	assert(hub.SafeSpawn(Vector2(180, 200)) == spawn) # counter
	assert(hub.SafeSpawn(Vector2(-1, -1)) == spawn)
	assert(hub.SafeSpawn(Vector2(999999, 999999)) == spawn)
	assert(not hub.Walkable(Vector2(INF, 0)))
	for area in hub.Data().areas:
		assert(hub.Walkable(hub.Point(area.approach)))
	# New room extends beyond the previous hardcoded click rectangle.
	assert(hub.Walkable(Vector2(800, 800)))
	print("HUB_SPAWN_PASS: safe saved positions, furniture/out-of-bounds fallback, expanded room")
	get_tree().quit(0)
