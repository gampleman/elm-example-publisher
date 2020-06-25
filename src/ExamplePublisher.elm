port module ExamplePublisher exposing (Document, Example, Program, application)

import Browser
import Html exposing (Html)
import Json.Decode as Decode exposing (Decoder, Value)
import Json.Encode


type alias Document =
    { title : String
    , body : List (Html Never)
    , meta : List ( String, String )
    }


type alias Example tags =
    { filename : String
    , basename : String
    , tags : tags
    , width : Int
    , height : Int
    , source : String
    , description : String
    , ellieLink : Maybe String
    }


type alias Model tags =
    { examples : List (Example tags)
    , state : State
    }


type State
    = ListView
    | ShowView String
    | Error


type Msg
    = Proceed String
    | Noop


type alias Program tags =
    Platform.Program Value (Model tags) Msg


application :
    { tagDecoder : Decoder tags
    , indexView : List (Example tags) -> Document
    , showView : Example tags -> List (Example tags) -> Document
    }
    -> Program tags
application config =
    Browser.document
        { init = init config.tagDecoder config.indexView
        , view = view config.indexView config.showView
        , update = update config.showView
        , subscriptions = subscriptions
        }


port renderPagePort : Value -> Cmd msg


renderPage : String -> List ( String, String ) -> Cmd msg
renderPage name meta =
    renderPagePort
        (Json.Encode.object
            [ ( "name", Json.Encode.string name )
            , ( "meta"
              , Json.Encode.list
                    (\( k, v ) ->
                        Json.Encode.object
                            [ ( "key", Json.Encode.string k )
                            , ( "value", Json.Encode.string v )
                            ]
                    )
                    meta
              )
            ]
        )


port errorPort : String -> Cmd msg


init : Decoder tags -> (List (Example tags) -> Document) -> Value -> ( Model tags, Cmd Msg )
init tagDecoder listView flags =
    case Decode.decodeValue (exampleDecoder tagDecoder) flags of
        Ok examples ->
            ( { examples = examples, state = ListView }, renderPage "index" (listView examples).meta )

        Err errr ->
            ( { examples = [], state = Error }, errorPort (Decode.errorToString errr) )


renderShowView : (Example tags -> List (Example tags) -> Document) -> String -> List (Example tags) -> Document
renderShowView showView name examples =
    case
        List.filter (\ex -> ex.basename == name) examples
            |> List.head
    of
        Just current ->
            showView current examples

        Nothing ->
            { body = [], title = "error", meta = [] }


view listView showView model =
    let
        { body, title } =
            case model.state of
                ListView ->
                    listView model.examples

                ShowView name ->
                    renderShowView showView name model.examples

                Error ->
                    { body = [], title = "error", meta = [] }
    in
    { body = List.map (Html.map never) body, title = title }


update : (Example tags -> List (Example tags) -> Document) -> Msg -> Model tags -> ( Model tags, Cmd Msg )
update showView msg model =
    case msg of
        Proceed name ->
            ( { model | state = ShowView name }, renderPage name (renderShowView showView name model.examples).meta )

        Noop ->
            ( model, Cmd.none )


port proceed : (String -> msg) -> Sub msg


subscriptions model =
    proceed Proceed


exampleDecoder tagDecoder =
    Decode.list
        (Decode.map8
            (\filename basename tags width height source description ellieLink ->
                { filename = filename
                , basename = basename
                , tags = tags
                , width = width
                , height = height
                , source = source
                , description = description
                , ellieLink = ellieLink
                }
            )
            (Decode.field "filename" Decode.string)
            (Decode.field "basename" Decode.string)
            (Decode.field "tags" tagDecoder)
            (Decode.field "width" Decode.int)
            (Decode.field "height" Decode.int)
            (Decode.field "source" Decode.string)
            (Decode.field "description" Decode.string)
            (Decode.maybe (Decode.at [ "tags", "ellieLink" ] Decode.string))
        )
