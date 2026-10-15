extends "res://verification/SmokeClient.gd"

func _chat_text() -> String:
	var tab = Launcher.GUI.chatContainer.tabContainer.get_tab_control(GUICommons.ChatChannel.LOCAL)
	return tab.text if tab else ""

func _dialogue_text() -> String:
	var result: String = ""
	for node in Launcher.GUI.dialogueWindow.scrollable.textContainer.get_children():
		if node is RichTextLabel:
			result += node.text
	return result

func _run():
	if not await _wait_until(func(): return Launcher.Player and FSM.IsGameState() and NimrodBridge.client_identity.get("scope") == "lobby", "authorized lobby map", 45.0):
		return
	var role: String = OS.get_environment("LOBBY_TEST_ROLE")
	var expected: String = OS.get_environment("LOBBY_TEST_NAME")
	if Launcher.Player.nick != expected or Launcher.Map.currentMapID != "Nimrod Tavern".hash():
		printerr("MANA_SMOKE_FAIL: wrong character or lobby map")
		quit(1)
		return
	var game_id: int = NimrodBridge.client_identity.game_character_id
	if role == "live":
		if not await _wait_until(func(): return Launcher.Player.nick == OS.get_environment("LOBBY_TEST_RENAMED"), "live name refreshed from Nimrod", 45.0):
			return
		if int(NimrodBridge.client_identity.game_character_id) != game_id:
			quit(1)
			return
		print("LOBBY_LIVE_RENAME_PASS: name=%s game_id=%d" % [Launcher.Player.nick, game_id])
		Network.DisconnectAccount()
		await create_timer(0.5).timeout
		quit(0)
		return
	if role == "identity":
		print("LOBBY_IDENTITY_PASS: name=%s game_id=%d" % [expected, game_id])
		Network.DisconnectAccount()
		await create_timer(0.5).timeout
		quit(0)
		return
	Launcher.Action.set_physics_process(false)
	Network.TriggerCloseContext()
	if not await _wait_until(func(): return is_instance_valid(NimrodBridge.social.world_labels) and NimrodBridge.social.world_labels.get_child_count() == 5, "five social hub signs"):
		return
	assert(not Launcher.GUI.stats.hpStat.visible and not Launcher.GUI.actionBoxes.visible)
	Network.SetClickPos(Vector2(800, 800))
	if not await _wait_until(func(): return Launcher.Player.position.distance_to(Vector2(800, 800)) < 35, "expanded reading nook beyond old map bounds"):
		return
	if not await _wait_until(func(): return NimrodBridge.social.state.get("members", []).size() == 2, "two authorized players"):
		return
	var before: Vector2 = Launcher.Player.position
	Network.SetClickPos(Vector2(670 if role == "a" else 700, 480))
	if not await _wait_until(func(): return NimrodBridge.social.state.get("near_table", false), "server-confirmed table movement"):
		return
	if before.distance_to(Launcher.Player.position) < 5:
		quit(1)
		return
	var self_id: int = NimrodBridge.social.state.self
	var other: Dictionary = {}
	for member in NimrodBridge.social.state.members:
		if member.peer != self_id:
			other = member
	if not await _wait_until(func(): return Entities.Get(int(other.rid)) != null and Entities.Get(int(other.rid)).nick == other.name, "other player's sprite and identity"):
		return
	Network.TriggerChat(str(GUICommons.ChatChannel.LOCAL), "Lobby test hello " + role)
	if not await _wait_until(func(): return _chat_text().contains("Lobby test hello " + ("b" if role == "a" else "a")), "synchronized proximity chat"):
		return
	if role == "a":
		await create_timer(1.0).timeout
		Network.LobbyAction("invite", other.peer, 0)
		if not await _wait_until(func(): return not NimrodBridge.social.state.get("game", {}).is_empty(), "invitation created"):
			return
	else:
		if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "invite", "invitation received"):
			return
		await create_timer(1.0).timeout
		Network.LobbyAction("decline", 0, NimrodBridge.social.state.game.id)
	if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).is_empty(), "invitation declined"):
		return
	await create_timer(2.0).timeout
	if role == "a":
		Network.LobbyAction("invite", other.peer, 0)
	else:
		if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "invite", "second invitation"):
			return
		Network.LobbyAction("accept", 0, NimrodBridge.social.state.game.id)
	if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "playing", "both see accepted game"):
		return
	if not NimrodBridge.social.state.game.cards.is_empty():
		printerr("MANA_SMOKE_FAIL: hidden cards leaked")
		quit(1)
		return
	await create_timer(0.5).timeout
	Network.LobbyAction("reveal", 0, NimrodBridge.social.state.game.id)
	if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "finished", "authoritative shared result"):
		return
	print("LOBBY_SOCIAL_PASS: role=%s game=%s cards=%s winner=%s" % [role, NimrodBridge.social.state.game.id, NimrodBridge.social.state.game.cards, NimrodBridge.social.state.game.winner])
	if not await _wait_until(func(): return NimrodBridge.social.state.game.is_empty(), "finished match expires"):
		return
	await create_timer(1.0).timeout
	if role == "a":
		Network.LobbyAction("invite", other.peer, 0)
	else:
		if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "invite", "disconnect-test invitation"):
			return
		Network.LobbyAction("accept", 0, NimrodBridge.social.state.game.id)
	if not await _wait_until(func(): return NimrodBridge.social.state.get("game", {}).get("stage") == "playing", "disconnect during active match"):
		return
	if role == "b":
		await create_timer(1.0).timeout
		Network.DisconnectAccount()
		await create_timer(0.5).timeout
		quit(0)
		return
	if not await _wait_until(func(): return NimrodBridge.social.state.members.size() == 1 and NimrodBridge.social.state.game.is_empty(), "disconnect cleans game and roster"):
		return
	Network.SetClickPos(Vector2(480, 290))
	if not await _wait_until(func(): return Launcher.Player.position.distance_to(Vector2(480, 290)) < 35, "approached tavern counter"):
		return
	var keeper: Entity = Entities.GetNamed("Anfitriã")
	if not keeper:
		printerr("MANA_SMOKE_FAIL: missing tavern keeper")
		quit(1)
		return
	Network.TriggerInteract(keeper.agentRID)
	if not await _wait_until(func(): return _dialogue_text().contains("O que deseja beber"), "NPC drinks menu"):
		return
	await create_timer(3.0).timeout
	Network.TriggerChoice(0)
	if not await _wait_until(func(): return _dialogue_text().contains("Por conta da casa"), "server confirms fictional drink"):
		return
	print("LOBBY_NPC_PASS: menu and recreational drink; no payment or attribute change")
	Network.DisconnectAccount()
	await create_timer(0.5).timeout
	quit(0)
