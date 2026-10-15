extends NpcScript

func OnStart():
	Mes("Bem-vindo à taverna, " + own.nick.replace("[", "[lb]") + ". O que deseja beber?")
	Choice("Suco de maçã", _serve.bind("suco de maçã"))
	Choice("Chá de ervas", _serve.bind("chá de ervas"))
	Choice("Água fresca", _serve.bind("água fresca"))
	Choice("Nada por enquanto", OnQuit)

func _serve(drink: String):
	Chat(own.nick.replace("[", "[lb]") + " saboreia " + drink + ".")
	Mes("Aqui está seu " + drink + ". Por conta da casa!")
	Choice("Obrigado", OnQuit)
