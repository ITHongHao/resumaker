from app.cater import _card_text, _citable, _numbers_traceable, _prompt_card, card_supports
from app.latex.template import Bullet, render_tex
from app.models import Card, Job, Profile, Requirement


def _golden_inputs():
    """Cards without any of the new keys: the resume must stay exactly as it was."""
    profile = Profile(name="Ann Lee", email="ann@x.com", phone="555-1234", links=["github.com/ann"])
    jobs = [Job(id=1, company="Acme", title="Dev", location="NYC", start_date="Jan 2020", end_date="")]
    cards = {
        "education": [Card(id=10, kind="education", title="MIT", description="BS CS",
                           extra={"location": "Cambridge, MA", "start_date": "2016",
                                  "end_date": "2020"}),
                      Card(id=11, kind="education", title="Night School", description="Diploma")],
        "projects": [Card(id=12, kind="project", title="Proj", tags=["Python", "Go"],
                          extra={"start_date": "2021", "end_date": "2022"})],
        "skills": [Card(id=13, kind="skill", title="Python", extra={"category": "Languages"}),
                   Card(id=14, kind="skill", title="Git")],
        "certifications": [Card(id=15, kind="certificate", title="AWS SA", description="Amazon",
                                extra={"date": "2023"})],
    }
    bullets = [Bullet("experience", 1, "Built a thing", 100),
               Bullet("projects", None, "Proj bullet", 12)]
    return profile, jobs, bullets, cards


GOLDEN = '%-------------------------\n% Resume in Latex\n% Author : Jake Gutierrez\n% Based off of: https://github.com/sb2nov/resume\n% License : MIT\n% Source: https://github.com/jakegut/resume\n%------------------------\n\n\\documentclass[letterpaper,11pt]{article}\n\n\\usepackage{latexsym}\n\\usepackage[empty]{fullpage}\n\\usepackage{titlesec}\n\\usepackage{marvosym}\n\\usepackage[usenames,dvipsnames]{color}\n\\usepackage{verbatim}\n\\usepackage{enumitem}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{fancyhdr}\n\\usepackage[english]{babel}\n\\usepackage{tabularx}\n% glyphtounicode needs pdfTeX primitives; skip it under XeTeX (Tectonic).\n\\ifdefined\\pdfgentounicode\n\\input{glyphtounicode}\n\\fi\n\n\\pagestyle{fancy}\n\\fancyhf{} % clear all header and footer fields\n\\fancyfoot{}\n\\renewcommand{\\headrulewidth}{0pt}\n\\renewcommand{\\footrulewidth}{0pt}\n\n% Adjust margins\n\\addtolength{\\oddsidemargin}{-0.5in}\n\\addtolength{\\evensidemargin}{-0.5in}\n\\addtolength{\\textwidth}{1in}\n\\addtolength{\\topmargin}{-.5in}\n\\addtolength{\\textheight}{1.0in}\n\n\\urlstyle{same}\n\n\\raggedbottom\n\\raggedright\n\\setlength{\\tabcolsep}{0in}\n\n% Sections formatting\n\\titleformat{\\section}{\n  \\vspace{-4pt}\\scshape\\raggedright\\large\n}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]\n\n% Ensure that generate pdf is machine readable/ATS parsable\n\\ifdefined\\pdfgentounicode\n\\pdfgentounicode=1\n\\fi\n\n%-------------------------\n% Custom commands\n\\newcommand{\\resumeItem}[1]{\n  \\item\\small{\n    {#1 \\vspace{-2pt}}\n  }\n}\n\n\\newcommand{\\resumeSubheading}[4]{\n  \\vspace{-2pt}\\item\n    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\n      \\textbf{#1} & #2 \\\\\n      \\textit{\\small#3} & \\textit{\\small #4} \\\\\n    \\end{tabular*}\\vspace{-7pt}\n}\n\n\\newcommand{\\resumeSubSubheading}[2]{\n    \\item\n    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\n      \\textit{\\small#1} & \\textit{\\small #2} \\\\\n    \\end{tabular*}\\vspace{-7pt}\n}\n\n\\newcommand{\\resumeProjectHeading}[2]{\n    \\item\n    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\n      \\small#1 & #2 \\\\\n    \\end{tabular*}\\vspace{-7pt}\n}\n\n\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}\n\n\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}\n\n\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}\n\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}\n\\newcommand{\\resumeItemListStart}{\\begin{itemize}}\n\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}\n\n%-------------------------------------------\n%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%\n\n\\begin{document}\n\n\\begin{center}\n    \\textbf{\\Huge \\scshape Ann Lee} \\\\ \\vspace{1pt}\n    \\small 555-1234 $|$ \\href{mailto:ann@x.com}{\\underline{ann@x.com}} $|$ \\href{https://github.com/ann}{\\underline{github.com/ann}}\n\\end{center}\n\n\\section{Education}\n  \\resumeSubHeadingListStart\n    \\resumeSubheading\n      {MIT}{Cambridge, MA}\n      {BS CS}{2016 -- 2020}\n    \\resumeSubheading\n      {Night School}{}\n      {Diploma}{}\n  \\resumeSubHeadingListEnd\n\n\\section{Experience}\n  \\resumeSubHeadingListStart\n    \\resumeSubheading\n      {Dev}{Jan 2020 -- Present}\n      {Acme}{NYC}\n      \\resumeItemListStart\n        \\resumeItem{Built a thing}\n      \\resumeItemListEnd\n  \\resumeSubHeadingListEnd\n\n\\section{Projects}\n  \\resumeSubHeadingListStart\n    \\resumeProjectHeading\n      {\\textbf{Proj} $|$ \\emph{Python, Go}}{2021 -- 2022}\n      \\resumeItemListStart\n        \\resumeItem{Proj bullet}\n      \\resumeItemListEnd\n  \\resumeSubHeadingListEnd\n\n\\section{Technical Skills}\n \\begin{itemize}[leftmargin=0.15in, label={}]\n    \\small{\\item{\n     \\textbf{Languages}{: Python} \\\\\n     \\textbf{Skills}{: Git}\n    }}\n \\end{itemize}\n\n\\section{Certifications}\n  \\resumeSubHeadingListStart\n    \\resumeProjectHeading\n      {\\textbf{AWS SA $|$ \\emph{Amazon}}}{2023}\n  \\resumeSubHeadingListEnd\n\n\\end{document}\n'  # captured from the code before the change


def test_existing_cards_render_identically():
    assert render_tex(*_golden_inputs()) == GOLDEN


def _edu(**extra):
    return {"education": [Card(id=1, kind="education", title="MIT", description="BS CS",
                               extra=extra)]}


def _render(cards):
    profile, jobs, bullets, _ = _golden_inputs()
    return render_tex(profile, jobs, [], cards)


def test_education_degree_line_uses_degree_and_field():
    tex = _render(_edu(degree_type="Bachelor's", field_of_study="Computer Science"))
    assert "Bachelor's, Computer Science" in tex
    assert "BS CS" not in tex
    tex = _render(_edu(degree_type="Bachelor's"))
    assert "{Bachelor's}" in tex and "BS CS" not in tex
    assert "BS CS" in _render(_edu())


def test_gpa_never_printed():
    tex = _render(_edu(degree_type="BS", gpa="3.97", gpa_scale="4.0", minor="Math"))
    assert "3.97" not in tex and "Math" not in tex


def _project():
    return Card(id=2, kind="project", title="Infra", description="", details="",
                extra={"role": "Kubernetes lead", "notes": "saved 40%"})


def test_stored_only_extras_are_not_evidence():
    card = _project()
    assert not card_supports(card, Requirement(term="Kubernetes", kind="skill", weight=1))
    assert not _numbers_traceable("saved 40%", _card_text(card))


def test_prompt_card_omits_stored_only_extras():
    card = Card(id=3, kind="project", title="Infra", description="d",
                extra={"role": "Lead", "notes": "n", "start_date": "2021"})
    assert _prompt_card(card)["extra"] == {"start_date": "2021"}


def test_citable_keeps_education_degree_fields():
    card = Card(id=4, kind="education", title="MIT", description="x",
                extra={"degree_type": "BS", "field_of_study": "CS", "gpa": "3.9"})
    assert _citable(card).extra == {"degree_type": "BS", "field_of_study": "CS"}
