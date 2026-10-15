extends Node

func _ready():
	get_tree().create_timer(90.0).timeout.connect(func():
		printerr("MANA_SMOKE_FAIL: overall timeout")
		quit(1)
	)
	_run.call_deferred()

func create_timer(seconds : float) -> SceneTreeTimer:
	return get_tree().create_timer(seconds)

func quit(code : int = 0):
	get_tree().quit(code)

func _wait_until(predicate : Callable, label : String, seconds : float = 25.0) -> bool:
	var deadline : int = Time.get_ticks_msec() + int(seconds * 1000)
	while Time.get_ticks_msec() < deadline:
		if predicate.call():
			print("MANA_SMOKE_STEP: " + label)
			return true
		await create_timer(0.1).timeout
	printerr("MANA_SMOKE_FAIL: " + label)
	quit(1)
	return false

func _has_character(nickname : String) -> bool:
	for info in Launcher.GUI.characterPanel.charactersInfo:
		if info.get("nickname", "") == nickname:
			return true
	return false

func _assets_ready() -> bool:
	return DB.isInitialized and not DB.HairstylesDB.is_empty() and not DB.RacesDB.is_empty() and DB.PalettesDB.size() > DB.Palette.HAIR and not DB.PalettesDB[DB.Palette.HAIR].is_empty()

func _run():
	if not await _wait_until(func(): return Network.clientConnected and DB.isInitialized and Launcher.GUI and Launcher.GUI.isInitialized, "connected to dedicated server"):
		return
	if Network.ENetServer or Network.WebSocketServer:
		printerr("MANA_SMOKE_FAIL: client started an offline server")
		quit(1)
		return
	var account : String = OS.get_environment("MANA_SMOKE_ACCOUNT")
	var password : String = OS.get_environment("MANA_SMOKE_PASSWORD")
	var reuse : bool = not account.is_empty()
	if not reuse:
		account = "phase2_" + str(Time.get_unix_time_from_system()).replace(".", "_")
		password = "LocalTest_" + str(randi())
	var nickname : String = account.left(28)
	if reuse:
		Network.LoginWithPassword(account, password, false)
	else:
		Network.CreateAccount(account, password, account + "@example.invalid", false)
	if not await _wait_until(func(): return FSM.currentState == FSM.States.CHAR_SCREEN, "account authenticated"):
		return
	if not reuse:
		if not await _wait_until(_assets_ready, "character assets ready"):
			return
		await create_timer(1.2).timeout
		var traits : Dictionary = Launcher.GUI.characterPanel.traitsPanel.GetValues()
		Network.CreateCharacter(nickname, traits, ActorCommons.DefaultAttributes)
	if not await _wait_until(func(): return _has_character(nickname), "character loaded from server"):
		return
	await create_timer(1.2).timeout
	Network.ConnectCharacter(nickname)
	if not await _wait_until(func(): return Launcher.Player != null and FSM.IsGameState(), "entered authoritative map"):
		return
	await create_timer(1.0).timeout
	# New characters enter the upstream tutorial dialogue, which locks movement.
	Network.TriggerCloseContext()
	await create_timer(0.5).timeout
	get_viewport().gui_release_focus()
	await create_timer(0.1).timeout
	var player : Entity = Launcher.Player
	var before : Vector2 = player.position
	var frame_before : int = player.lastUpdateFrameID
	# Headless clients have no keyboard focus; exercise the actual movement RPC.
	Launcher.Action.set_physics_process(false)
	var distance : float = 0.0
	for direction in [Vector2.DOWN, Vector2.RIGHT, Vector2.UP, Vector2.LEFT]:
		Network.SetMovePos(direction)
		await create_timer(1.5).timeout
		Network.SetMovePos(Vector2.ZERO)
		await create_timer(0.3).timeout
		distance = before.distance_to(player.position)
		print("MANA_SMOKE_MOVE: direction=%s pos=%s frame=%d" % [direction, player.position, player.lastUpdateFrameID])
		if distance >= 2.0:
			break
	if distance < 2.0 or player.lastUpdateFrameID <= frame_before or Network.Client.isOffline or Network.ENetServer or Network.WebSocketServer:
		printerr("MANA_SMOKE_FAIL: no server-confirmed movement: " + str(distance))
		quit(1)
		return
	print("MANA_SMOKE_PASS: account=%s character=%s movement=%.2fpx server_frame=%d->%d" % [account, nickname, distance, frame_before, player.lastUpdateFrameID])
	Network.DisconnectAccount()
	await create_timer(0.5).timeout
	quit(0)
