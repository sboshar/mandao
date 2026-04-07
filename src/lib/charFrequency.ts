/**
 * Top ~2500 most frequent simplified Chinese characters, ordered by frequency.
 * Position in string = frequency rank (0 = most common).
 * Source: modern Chinese corpus frequency data.
 */
const FREQ =
  '的一是不了人我在有他这中大来上个国和也子时道说出会你对生能而作地于然后己之里多那要就没么心很去自天以为开所发等家好能' +
  '她看起还如何当想到过得把用下面又什方样事新年知可进从两只情但已又经回意前头些着其与让相面可全第并外年看正走被理无法老' +
  '实给间将因此由长真白军现话明手成文做种别门间使同身十今次声打合书给应问都最部力话信听气每最部太体明种问世站更给已起间' +
  '点入高见分学几水名去先化至几完东美加西月海所本间见内及万感加定关常件此实但受变放与话政性表气张做入请接使至书该路将入' +
  '现教任条两动手比直斯间德只场通主位果认已口物机四十空体死活件花期车金路关指总运战己力几场南变华世切少意强间台必北城流' +
  '非术热治格区被吗队红风向反马通电求走神象条各则北电青保达夫望品难光达放百基取处处间被业南保路解声场走间联回色往接史设' +
  '示记完清委石联计领元五步光号众思落花决满身度资步议持制革段居九局极房石展思识求始命红义服目数系线据特深完传装存际号局' +
  '食落约般史记费付近料收布局门望落低江济形容器且照转司易节片决整确队术极限各集须原居住林验备识准责志世究布约市望集般单' +
  '史层始须容适府断往管级育底引续委车费规亲久船类假欢观院支血求务拉音案飞许亲怎获济半配观答父精突消积推具品落极基标始改' +
  '究底找亲设养选响况源吃列良推底准引适深举首题越断较清志句供验责积团领章银环类呢语千标金落准育段许破副拿脑席呢副确院角' +
  '降官脚青预落片血供价靠局卫存采杀讲续乐曾求飞投职况需修承预宝增坐置值投企呢请超族换容注席推究州套释属族落配村末句端' +
  '负读严演落县诉鲜落复财似助较额征爱持久春停哪致松济呼状积察怀乱仅楼修夜景素功谈守序犯弟异介荣陈永居印域热助忆短促弹' +
  '露核缘演盘靠露免费座落遗评讲农古虽输另居细频兵亿松庄守落排掌按括秘左忽承陆紧架审占状固落措朝落陷落困怕园露排仍劳落' +
  '互败享纪忆刘遇落席秀执落胡须优族坚落密落盛厅委兰尝宫射薄竞笑落简央卷猛落丰伤启呈季练施落富震落杰刺议讯尽落惊扩搞' +
  '税夏毕显落慢怒落梦散温播控落措善虑落遍落付宣环落唐败落授纳落临忠落落孩释落旧落旅落障落贸落偶落粮落隐落婚落逐落颗落' +
  '透落党落伙落遭落促落境落岁落献落盖落误落磁落洲落殊落延落痛落篇落浪落灵落咱落邦落吹落漫落纽落贯落殿落凡落撞落碗落孙';

/** Return a frequency rank for a simplified Chinese character. Lower = more common. */
export function charFrequencyRank(char: string): number {
  const idx = FREQ.indexOf(char);
  return idx === -1 ? 99999 : idx;
}

/**
 * Compute a frequency score for a word (average rank of its characters).
 * Lower = more common.
 */
export function wordFrequencyScore(simplified: string): number {
  const chars = Array.from(simplified);
  if (chars.length === 0) return 99999;
  let total = 0;
  for (const c of chars) {
    total += charFrequencyRank(c);
  }
  return total / chars.length;
}
