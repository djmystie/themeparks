import './Header.scss'

export default function Header({title, level, goBack}){
    return (
        <header>
            <div className={level ? "icon pointer" : "icon"} onClick={()=>goBack()}>{level ? "<" : null}</div>
            <div>{title}</div>
            <div className="icon"></div>
        </header>
    )
}