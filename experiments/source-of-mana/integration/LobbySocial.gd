extends Node

const Cards = preload("res://sources/integration/CardTable.gd")
const Hub = preload("res://sources/integration/HubLayout.gd")
var cards = Cards.new()
var cadence: float = 0.0
var chat_times: Dictionary = {}
var last_actions: Dictionary = {}
var state: Dictionary = {}
var panel: PanelContainer
var roster: OptionButton
var status_label: Label
var title_label: Label
var invite_button: Button
var accept_button: Button
var decline_button: Button
var reveal_button: Button
var presence_label: Label
var cards_toggle: Button
var cards_open: bool = false
var world_labels: Node2D
var combat_hidden: bool = false
var panel_body: VBoxContainer
var collapse_button: Button
var small_screen: bool = false
var board_hotspot: Button

func _process(delta: float):
	if Network.Client:
		var active: bool = NimrodBridge.client_identity.get("scope") == "lobby" and FSM.currentState == FSM.States.IN_GAME
		if active and not panel:
			_build_ui()
		if panel:
			panel.visible = active
			board_hotspot.visible = active and not NimrodBridge.nimrod_origin.is_empty()
			var compact: bool = get_viewport().get_visible_rect().size.x < 640
			if compact != small_screen:
				small_screen = compact
				_set_expanded(not compact)
		if active:
			Launcher.GUI.stats.SetBarsVisible(false)
			Launcher.GUI.actionBoxes.hide()
			Launcher.GUI.infoContext.hide()
			combat_hidden = true
			_decorate_map()
			if Launcher.Map.currentMapNode:
				var transform: Transform2D = Launcher.Map.currentMapNode.get_global_transform_with_canvas()
				board_hotspot.position = transform * Hub.Point(Hub.Data().boardBounds.slice(0, 2))
				board_hotspot.scale = transform.get_scale()
			else:
				board_hotspot.hide()
		elif combat_hidden:
			if FSM.currentState == FSM.States.IN_GAME:
				Launcher.GUI.stats.SetBarsVisible(true)
				Launcher.GUI.actionBoxes.show()
			combat_hidden = false
		return
	cadence += delta
	if cadence >= 2.0 and NimrodBridge.Enabled():
		cadence = 0.0
		var connected: Array = _members().map(func(member): return member.peer)
		cards.Prune(connected)
		for key in chat_times.keys():
			if key not in connected:
				chat_times.erase(key)
				last_actions.erase(key)
		_publish()

func IsLobby(peer: Peers.Peer) -> bool:
	return peer and peer.nimrod.get("scope") == "lobby" and Time.get_unix_time_from_system() < peer.nimrod.get("authorized_until", 0)

func ChatAllowed(peer_id: int, text: String) -> bool:
	if text.strip_edges().is_empty() or text.length() > 400 or text.contains("\n") or text.contains("\r"):
		return false
	var now: int = Time.get_ticks_msec()
	var times: Array = chat_times.get(peer_id, [])
	times = times.filter(func(time): return now - time < 10000)
	if times.size() >= 5:
		return false
	times.append(now)
	chat_times[peer_id] = times
	return true

func _members() -> Array:
	var members: Array = []
	for peer in Peers.peers.values():
		var player: PlayerAgent = Peers.GetAgent(peer.peerID)
		if IsLobby(peer) and player and Time.get_unix_time_from_system() < peer.nimrod.get("authorized_until", 0):
			members.append({"peer": peer.peerID, "rid": player.get_rid().get_id(), "name": player.nick})
	return members

func _at_table(peer_id: int) -> bool:
	var agent: PlayerAgent = Peers.GetAgent(peer_id)
	return agent and agent.position.distance_to(Hub.Point(Hub.Data().cardTable)) <= 220.0

func Action(action: String, target: int, game_id: int, peer_id: int):
	var peer: Peers.Peer = Peers.GetPeer(peer_id)
	if not IsLobby(peer) or not Peers.GetAgent(peer_id):
		return
	var now: int = Time.get_ticks_msec()
	if now - int(last_actions.get(peer_id, -1000)) < 300:
		return
	last_actions[peer_id] = now
	var changed: bool = false
	if action == "invite":
		var target_peer: Peers.Peer = Peers.GetPeer(target)
		if IsLobby(target_peer) and peer.nimrod.user_id != target_peer.nimrod.user_id and _at_table(peer_id) and _at_table(target):
			changed = cards.Invite(peer_id, target)
	elif action in ["accept", "decline", "reveal"]:
		if action == "decline" or _at_table(peer_id):
			changed = cards.Act(peer_id, game_id, action)
	if not changed:
		Network.ChatSystem(str(GUICommons.ChatChannel.LOCAL), "Ação indisponível. Aproxime-se da mesa de cartas; ambos devem estar livres.", peer_id)
	_publish()

func _publish():
	var members: Array = _members()
	for member in members:
		Network.LobbyState({"members": members, "self": member.peer, "game": cards.Snapshot(member.peer), "near_table": _at_table(member.peer)}, member.peer)

func Receive(snapshot: Dictionary):
	state = snapshot
	for member in state.get("members", []):
		var entity: Entity = Entities.Get(int(member.rid))
		if entity:
			entity.nick = member.name
			if entity.interactive:
				entity.interactive.displayName = false
				entity.interactive.nameLabel.visible = false
			var label: Label = entity.get_node_or_null("NimrodName")
			if not label:
				label = Label.new()
				label.name = "NimrodName"
				label.position = Vector2(-110, -84)
				label.size = Vector2(220, 40)
				label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
				label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				label.add_theme_color_override("font_color", Color("f1dc9a"))
				label.add_theme_color_override("font_shadow_color", Color.BLACK)
				label.add_theme_constant_override("shadow_offset_x", 1)
				label.add_theme_constant_override("shadow_offset_y", 1)
				entity.add_child(label)
			label.text = member.name
	_update_ui()

func _send(action: String):
	var target: int = roster.get_selected_id() if roster and roster.item_count else 0
	Network.LobbyAction(action, target, int(state.get("game", {}).get("id", 0)))

func _build_ui():
	var canvas := CanvasLayer.new()
	# The existing game GUI is layer 128. Keep social controls above its overlay
	# so visible buttons also receive pointer/touch input.
	canvas.layer = Launcher.GUI.layer + 1
	add_child(canvas)
	# Hit region follows the world-space mural but receives input above the GUI.
	board_hotspot = Button.new()
	board_hotspot.size = Hub.Point(Hub.Data().boardBounds.slice(2, 4))
	board_hotspot.flat = true
	board_hotspot.tooltip_text = "Mural de aventuras · abrir missões no Nimrod"
	board_hotspot.pressed.connect(NimrodBridge.OpenNimrod.bind("/missions"))
	canvas.add_child(board_hotspot)
	panel = PanelContainer.new()
	panel.position = Vector2(16, 72)
	panel.custom_minimum_size = Vector2(280, 0)
	canvas.add_child(panel)
	var background := StyleBoxFlat.new()
	background.bg_color = Color("21180feb")
	background.border_color = Color("8b7042")
	background.set_border_width_all(1)
	background.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", background)
	var margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 12)
	panel.add_child(margin)
	var frame := VBoxContainer.new()
	frame.add_theme_constant_override("separation", 8)
	margin.add_child(frame)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	frame.add_child(header)
	title_label = Label.new()
	title_label.text = "Inn do Nimrod"
	title_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title_label.custom_minimum_size.x = 218
	title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(title_label)
	collapse_button = Button.new()
	collapse_button.custom_minimum_size = Vector2(44, 44)
	collapse_button.text = "-"
	collapse_button.tooltip_text = "Recolher painel social"
	collapse_button.pressed.connect(func(): _set_expanded(not panel_body.visible))
	header.add_child(collapse_button)
	panel_body = VBoxContainer.new()
	panel_body.add_theme_constant_override("separation", 8)
	frame.add_child(panel_body)
	var box: VBoxContainer = panel_body
	presence_label = Label.new()
	presence_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	presence_label.custom_minimum_size.x = 270
	box.add_child(presence_label)
	var help := Label.new()
	help.text = "Clique, toque ou use WASD para circular.\nEncontre uma mesa e converse."
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help.custom_minimum_size.x = 270
	box.add_child(help)
	var chat_button := Button.new()
	chat_button.text = "Conversar (chat local)"
	chat_button.custom_minimum_size.y = 44
	chat_button.pressed.connect(Launcher.GUI.ToggleChatNewLine)
	box.add_child(chat_button)
	var board_button := Button.new()
	board_button.text = "Mural de aventuras"
	board_button.custom_minimum_size.y = 44
	board_button.disabled = NimrodBridge.nimrod_origin.is_empty()
	board_button.tooltip_text = "Abre as missões do Nimrod em outra aba; não inscreve seu personagem." if not board_button.disabled else "Acesse /missions na aba do Nimrod. Entre por Modo Jogo para habilitar este atalho."
	board_button.pressed.connect(NimrodBridge.OpenNimrod.bind("/missions"))
	box.add_child(board_button)
	var classic_button := Button.new()
	classic_button.text = "Modo Clássico"
	classic_button.custom_minimum_size.y = 44
	classic_button.disabled = NimrodBridge.nimrod_origin.is_empty()
	classic_button.pressed.connect(NimrodBridge.OpenNimrod.bind("/?experience=classic"))
	box.add_child(classic_button)
	cards_toggle = Button.new()
	cards_toggle.text = "Mesa de cartas (opcional)"
	cards_toggle.custom_minimum_size.y = 44
	cards_toggle.toggle_mode = true
	cards_toggle.toggled.connect(func(pressed: bool):
		cards_open = pressed
		_update_ui())
	box.add_child(cards_toggle)
	status_label = Label.new()
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status_label.custom_minimum_size.x = 270
	box.add_child(status_label)
	roster = OptionButton.new()
	box.add_child(roster)
	invite_button = _button(box, "Convidar", "invite")
	accept_button = _button(box, "Aceitar", "accept")
	decline_button = _button(box, "Recusar", "decline")
	reveal_button = _button(box, "Virar carta", "reveal")
	_update_ui()

func _set_expanded(expanded: bool):
	panel_body.visible = expanded
	collapse_button.text = "-" if expanded else "+"
	collapse_button.tooltip_text = "Recolher painel social" if expanded else "Expandir painel social"
	panel.reset_size()

func _button(box: VBoxContainer, title: String, action: String) -> Button:
	var button := Button.new()
	button.text = title
	button.custom_minimum_size.y = 44
	button.pressed.connect(_send.bind(action))
	box.add_child(button)
	return button

func _update_ui():
	if not panel:
		return
	var old: int = roster.get_selected_id() if roster.item_count else 0
	roster.clear()
	for member in state.get("members", []):
		if member.peer != state.get("self", 0):
			roster.add_item(str(member.name), int(member.peer))
	for index in roster.item_count:
		if roster.get_item_id(index) == old:
			roster.select(index)
	var game: Dictionary = state.get("game", {})
	var stage: String = str(game.get("stage", ""))
	var opponent: String = ""
	for member in state.get("members", []):
		if member.peer != state.get("self") and member.peer in game.get("players", []):
			opponent = str(member.name)
	presence_label.text = "%d aventureiro(s) na taverna\nBalcão ao norte · Mural a nordeste" % state.get("members", []).size()
	var invited: bool = stage == "invite" and game.players[1] == state.get("self")
	accept_button.visible = invited
	decline_button.visible = invited
	reveal_button.visible = stage == "playing"
	reveal_button.disabled = state.get("self") in game.get("revealed", [])
	invite_button.visible = cards_open and game.is_empty()
	invite_button.disabled = not state.get("near_table", false) or not roster.item_count
	roster.visible = cards_open and game.is_empty()
	status_label.visible = cards_open or not game.is_empty()
	status_label.text = "Aproxime-se da mesa de cartas." if not state.get("near_table", false) else "Uma carta por jogador. Ás é a maior; empate não tem vencedor."
	if stage == "invite":
		status_label.text = opponent + " convidou você." if invited else "Aguardando resposta de " + opponent + "..."
	elif stage == "playing":
		status_label.text = "Vire sua carta. A revelação ocorre quando ambos jogarem."
	elif stage == "finished":
		var winner_name: String = "Empate"
		for member in state.get("members", []):
			if member.peer == game.winner:
				winner_name = "Vencedor: " + str(member.name)
		status_label.text = "Cartas: %s × %s\n%s" % [_card_label(int(game.cards[0])), _card_label(int(game.cards[1])), winner_name]
	# Shrink again after the optional card controls close.
	panel.reset_size()

func _decorate_map():
	if is_instance_valid(world_labels) or not Launcher.Map.currentMapNode or Launcher.Map.currentMapID != "Nimrod Tavern".hash():
		return
	world_labels = Node2D.new()
	world_labels.name = "NimrodHubSigns"
	world_labels.z_index = 20
	Launcher.Map.currentMapNode.add_child(world_labels)
	for area in Hub.Data().get("areas", []):
		var label := Label.new()
		label.text = str(area.name)
		label.position = Hub.Point(area.label)
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		label.add_theme_font_size_override("font_size", 16)
		label.add_theme_color_override("font_color", Color("f5dca0"))
		label.add_theme_color_override("font_shadow_color", Color("20130d"))
		label.add_theme_constant_override("shadow_offset_x", 2)
		label.add_theme_constant_override("shadow_offset_y", 2)
		world_labels.add_child(label)

func _card_label(rank: int) -> String:
	return {11: "J", 12: "Q", 13: "K", 14: "Ás"}.get(rank, str(rank))
