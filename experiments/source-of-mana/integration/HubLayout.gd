extends RefCounted

# Generated alongside the Tiled scene; preloaded resources survive web export.
const Layout = preload("res://sources/integration/HubLayoutData.gd")

static func Data() -> Dictionary:
	return Layout.DATA

static func Point(value: Array) -> Vector2:
	return Vector2(float(value[0]), float(value[1]))

static func Walkable(point: Vector2) -> bool:
	var data: Dictionary = Data()
	if not point.is_finite() or data.is_empty():
		return false
	var x: int = floori(point.x / float(data.tileSize))
	var y: int = floori(point.y / float(data.tileSize))
	return x >= 0 and y >= 0 and x < int(data.width) and y < int(data.height) and int(data.collision[y * int(data.width) + x]) == 0

static func SafeSpawn(point: Vector2) -> Vector2:
	for offset in [Vector2.ZERO, Vector2(12, 0), Vector2(-12, 0), Vector2(0, 12), Vector2(0, -12)]:
		if not Walkable(point + offset):
			return Point(Data().get("spawn", [480, 560]))
	return point
