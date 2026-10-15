extends Node

const Hub = preload("res://sources/integration/HubLayout.gd")
var nimrod_origin: String = ""
var client_identity: Dictionary = {}
var pending: Dictionary = {}
var client_ticket: String = ""
var sent: bool = false
var elapsed: float = 0.0
var social: Node

func Enabled() -> bool:
	return OS.get_environment("MANA_INTEGRATED") == "true"

func _ready():
	social = preload("res://sources/integration/LobbySocial.gd").new()
	add_child(social)
	if OS.has_feature("web"):
		# Non-secret navigation hint. Accept only an HTTP origin on this host.
		nimrod_origin = str(JavaScriptBridge.eval("(() => { try { const value = new URL(location.href).searchParams.get('nimrod_origin'); if (!value) return ''; const url = new URL(value); const loopback = h => ['localhost', '127.0.0.1', '[::1]'].includes(h); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href === url.origin + '/' && (url.hostname === location.hostname || (loopback(url.hostname) && loopback(location.hostname))) ? url.origin : ''; } catch { return ''; } })()"))
		var fragment: String = str(JavaScriptBridge.get_interface("window").location.hash)
		if fragment.begins_with("#nimrod="):
			client_ticket = fragment.trim_prefix("#nimrod=")
			print("Nimrod: access ticket detected")
			JavaScriptBridge.eval("history.replaceState(null, '', location.pathname + location.search)")
	else:
		client_ticket = OS.get_environment("MANA_SMOKE_TOKEN")

func _process(delta: float):
	if not client_ticket.is_empty() and not sent and Network.Client and Network.clientConnected and Launcher.GUI and Launcher.GUI.isInitialized:
		if Network.LoginWithNimrod(client_ticket):
			print("Nimrod: validating access")
			sent = true
			client_ticket = ""
			FSM.EnterState(FSM.States.LOGIN_PROGRESS)
	if Enabled() and Network.WebSocketServer:
		elapsed += delta
		if elapsed >= 30.0:
			elapsed = 0.0
			_check_access()

func _request(path: String, body: Dictionary) -> Dictionary:
	var base: String = OS.get_environment("MANA_NIMROD_API").trim_suffix("/")
	var secret: String = OS.get_environment("MANA_BRIDGE_SECRET")
	if base.is_empty() or secret.length() < 32:
		return {}
	var request := HTTPRequest.new()
	request.timeout = 8.0
	add_child(request)
	var err := request.request(base + path, ["Content-Type: application/json", "Authorization: Bearer " + secret], HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		request.queue_free()
		return {}
	var response: Array = await request.request_completed
	request.queue_free()
	if response[0] != HTTPRequest.RESULT_SUCCESS or response[1] != 200:
		return {}
	var value = JSON.parse_string(response[3].get_string_from_utf8())
	return value if value is Dictionary else {}

func Login(token: String, peer_id: int):
	var peer: Peers.Peer = Peers.GetPeer(peer_id)
	if not Enabled() or not peer or pending.has(peer_id) or token.length() != 64 or peer.accountID != NetworkCommons.PeerUnknownID:
		Network.AuthError(NetworkCommons.AuthError.ERR_TOKEN, peer_id)
		return
	pending[peer_id] = true
	var identity: Dictionary = await _request("/mana/redeem", {"token": token})
	pending.erase(peer_id)
	if Peers.GetPeer(peer_id) != peer:
		return
	if identity.is_empty() or not _provision(identity, peer):
		Network.AuthError(NetworkCommons.AuthError.ERR_TOKEN, peer_id)
		return
	peer.nimrod = identity
	Network.AuthError(NetworkCommons.AuthError.ERR_OK, peer_id)
	Network.NimrodIdentity(identity, peer_id)

func _provision(identity: Dictionary, peer: Peers.Peer) -> bool:
	# Stable keys, not display names, keep minigame progress independent from D&D.
	var account_key: String = "nimrod_" + str(identity.get("user_id", ""))
	var character_key: String = "nimrod_" + str(identity.get("character_id", ""))
	if account_key.length() != 43 or character_key.length() != 43:
		return false
	var sql: SQLService = Launcher.SQL
	if not sql.ExecuteBindings("BEGIN IMMEDIATE", []):
		return false
	if not sql.HasAccount(account_key) and not sql.AddAccount(account_key, Hasher.GenerateSalt(64), ""):
		sql.Query("ROLLBACK")
		return false
	var account_id: int = sql.GetAccountID(account_key)
	var existing: Array[Dictionary] = sql.QueryBindings("SELECT char_id FROM character WHERE nickname = ?", [character_key])
	if existing.is_empty():
		if DB.HairstylesDB.is_empty() or DB.RacesDB.is_empty() or DB.PalettesDB[DB.Palette.HAIR].is_empty():
			sql.Query("ROLLBACK")
			return false
		var race_key: int = DB.RacesDB.keys()[0]
		var race: RaceData = DB.GetRace(race_key)
		var traits: Dictionary = ActorCommons.DefaultTraits.duplicate()
		traits.merge({"hairstyle": DB.HairstylesDB.keys()[0], "haircolor": DB.PalettesDB[DB.Palette.HAIR].keys()[0],
			"race": race_key, "skintone": race.skins.keys()[0].hash(), "gender": ActorCommons.Gender.MALE}, true)
		# SQLite's update_rows opens its own transaction; use bound statements here.
		if not sql.ExecuteBindings("INSERT INTO character (account_id, nickname, created_timestamp) VALUES (?, ?, ?)", [account_id, character_key, SQLCommons.Timestamp()]):
			sql.Query("ROLLBACK")
			return false
		var char_id: int = sql.GetCharacterID(account_id, character_key)
		for entry in [["stat", ActorCommons.DefaultStats], ["trait", traits], ["attribute", ActorCommons.DefaultAttributes]]:
			var setters: Array[String] = []
			var values: Array = []
			for column in entry[1]:
				setters.append(str(column) + " = ?")
				values.append(entry[1][column])
			values.append(char_id)
			if not sql.ExecuteBindings("UPDATE " + entry[0] + " SET " + ", ".join(setters) + " WHERE char_id = ?", values):
				sql.Query("ROLLBACK")
				return false
		for item in ActorCommons.DefaultInventory:
			if not sql.AddItem(char_id, item.get("item_id", DB.UnknownHash), item.get("customfield", ""), item.get("count", 1)):
				sql.Query("ROLLBACK")
				return false
		for skill in ActorCommons.DefaultSkills:
			if not sql.SetSkill(char_id, skill.get("skill_id", DB.UnknownHash), skill.get("level", 1)):
				sql.Query("ROLLBACK")
				return false
	else:
		if not sql.ExecuteBindings("UPDATE character SET account_id = ? WHERE char_id = ?", [account_id, existing[0].char_id]):
			sql.Query("ROLLBACK")
			return false
	if not sql.ExecuteBindings("COMMIT", []):
		sql.Query("ROLLBACK")
		return false
	for other in Peers.peers.values():
		if other != peer and (other.accountID == account_id or other.nimrod.get("character_id") == identity.character_id):
			var server: NetServer = Peers.GetAssociatedNetServer(other.peerID)
			if server:
				server.DisconnectAccount(other.peerID)
			other.nimrod = {}
			Network.NimrodIdentity({}, other.peerID)
	var result := Peers.FinalizeLogin(peer, account_key, Peers.AccountData.new(account_id, ActorCommons.Permission.NONE), NetworkCommons.Platform.UNKNOWN, false)
	identity["character_key"] = character_key
	return result == NetworkCommons.AuthError.ERR_OK

func AcceptIdentity(identity: Dictionary):
	var already_authenticated: bool = not client_identity.is_empty()
	client_identity = identity
	if identity.is_empty():
		FSM.EnterState(FSM.States.LOGIN_SCREEN)
		return
	if already_authenticated:
		return
	var deadline: int = Time.get_ticks_msec() + 60000
	while Time.get_ticks_msec() < deadline:
		if FSM.currentState == FSM.States.CHAR_SCREEN and Launcher.GUI:
			for info in Launcher.GUI.characterPanel.charactersInfo:
				if info.get("nickname") == identity.character_key:
					if Network.ConnectCharacter(str(identity.character_key)):
						FSM.EnterState(FSM.States.CHAR_PROGRESS)
					return
		await get_tree().process_frame
	FSM.EnterState(FSM.States.LOGIN_SCREEN)

func Allowed(peer: Peers.Peer, method: StringName, args: Array) -> bool:
	if not Enabled():
		return true
	if method == "LoginWithNimrod" or method == "DisconnectAccount" or method == "DisconnectCharacter":
		return true
	if not peer or peer.nimrod.is_empty():
		return false
	if Time.get_unix_time_from_system() >= peer.nimrod.get("authorized_until", 0.0):
		return false
	if method in ["CreateAccount", "LoginWithPassword", "LoginWithToken", "CreateCharacter", "DeleteCharacter", "RequestPasswordReset", "ConfirmPasswordReset", "ChangePassword"]:
		return false
	if method == "ConnectCharacter" and (args.is_empty() or args[0] != peer.nimrod.character_key):
		return false
	if peer.nimrod.get("scope") == "lobby" and method in ["SetClickPos", "SetMovePos", "SetOrientation"]:
		if args.is_empty() or not args[0].is_finite():
			return false
		if method == "SetClickPos" and not Hub.Walkable(args[0]):
			return false
	if peer.nimrod.get("scope") == "lobby" and method not in ["ConnectCharacter", "CharacterListing", "RetrieveCharacterInformation", "RequestOnlineList", "SetClickPos", "SetMovePos", "SetOrientation", "ClearNavigation", "SetViewportSize", "TriggerSit", "TriggerEmote", "TriggerChat", "TriggerChoice", "TriggerNextContext", "TriggerCloseContext", "TriggerInteract", "TriggerSelect", "LobbyAction"]:
		return false
	return true

func LobbySpawn(char_info: Dictionary, peer: Peers.Peer) -> SpawnObject:
	if peer.nimrod.get("scope") != "lobby":
		return PlayerAgent.GetSpawnFromData(char_info)
	var map: WorldMap = Launcher.World.GetMap("Nimrod Tavern".hash())
	if not map:
		return null
	var spawn := SpawnObject.new()
	spawn.map = map
	spawn.type = ActorCommons.Type.PLAYER
	spawn.id = DB.PlayerHash
	spawn.spawn_position = Vector2i(Hub.Point(Hub.Data().get("spawn", [480, 560])))
	if char_info.get("pos_map") == map.id:
		var position := Vector2i(int(char_info.get("pos_x", 480)), int(char_info.get("pos_y", 560)))
		spawn.spawn_position = Vector2i(Hub.SafeSpawn(Vector2(position)))
	return spawn

func OpenNimrod(path: String):
	if not OS.has_feature("web") or nimrod_origin.is_empty() or path not in ["/missions", "/?experience=classic"]:
		return
	JavaScriptBridge.eval("window.open(%s, '_blank', 'noopener,noreferrer')" % JSON.stringify(nimrod_origin + path))

func _check_access():
	for peer in Peers.peers.values():
		if peer.nimrod.is_empty():
			continue
		_verify_peer(peer)

func _verify_peer(peer: Peers.Peer):
	var grant: String = str(peer.nimrod.grant_id)
	var valid: Dictionary = await _request("/mana/authorize", {"grant_id": grant})
	if Peers.GetPeer(peer.peerID) != peer or peer.nimrod.get("grant_id") != grant:
		return
	if valid.is_empty():
		var server: NetServer = Peers.GetAssociatedNetServer(peer.peerID)
		if server:
			server.DisconnectAccount(peer.peerID)
		peer.nimrod = {}
		Network.NimrodIdentity({}, peer.peerID)
		Network.AuthError(NetworkCommons.AuthError.ERR_TOKEN, peer.peerID)
	else:
		peer.nimrod["authorized_until"] = valid.authorized_until
		peer.nimrod["display_name"] = valid.display_name
		peer.nimrod["character_name"] = valid.character_name
		var agent: PlayerAgent = Peers.GetAgent(peer.peerID)
		if agent:
			agent.nick = valid.character_name
		Network.NimrodIdentity(peer.nimrod, peer.peerID)
